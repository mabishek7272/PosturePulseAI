import { useCallback, useEffect, useRef, useState } from "react";
import type { SharedValue } from "react-native-reanimated";
import { MotionTracker, STEADY_RELEASE_FACTOR, STEADY_THRESHOLD, evaluateGuidance, unavailableGuidance, type Guidance } from "./guidance";
import { visibleCount } from "./pose-overlay";
import type { PoseSnapshot } from "./pose-overlay";
import { addFrame, emptyAccumulator, summarise, type SqiAccumulator, type SqiSummary } from "./sqi";

/** JS-side sampling rate of the pose guide's keypoints (frames are ~30 Hz; this is deliberately cheaper). */
const SAMPLE_MS = 100;

export interface LiveStats extends SqiSummary {
  /** Current continuous steady+aligned run, seconds. */
  streakSeconds: number;
  /** Subject is steady and framed right now. */
  steadyNow: boolean;
}

/**
 * Live sensor readings for the capture screen's readout panel. Display only:
 * none of this is uploaded or used by the server. `null` = not available now
 * (shown as a dash, never as 0).
 */
export interface Telemetry {
  rollDeg: number | null;
  pitchDeg: number | null;
  /** Keypoint span as a fraction of frame height (the distance gauge's input). */
  span: number | null;
  /** RMS hip wander, fraction of frame height. */
  motion: number | null;
  /** The limit `motion` is judged against right now (relaxed once steady). */
  steadyLimit: number;
  /** Mean MoveNet score of the visible keypoints, 0..1. */
  confidence: number | null;
  /** Keypoints currently shown (0-17). */
  visiblePoints: number;
}

export const EMPTY_TELEMETRY: Telemetry = {
  rollDeg: null, pitchDeg: null, span: null, motion: null, steadyLimit: STEADY_THRESHOLD, confidence: null, visiblePoints: 0,
};

/** Readout refresh interval: fast enough to watch, slow enough not to re-render the camera screen 10x/s. */
const TELEMETRY_MS = 250;

interface Options {
  pose: SharedValue<PoseSnapshot>;
  view: string;
  /** Pose model + resizer are running. When false nothing is analysed and no SQI is produced. */
  available: boolean;
  /** Latest phone roll in degrees (null when unknown). */
  rollRef: { current: number | null };
  /** Latest phone forward/back tilt in degrees (null when unknown). */
  pitchRef: { current: number | null };
}

/**
 * Samples the pose guide's keypoints at ~10 Hz on the JS thread (the frame
 * worklet only writes them), runs the pure guidance checks, and - between
 * beginRecording() and endRecording() - accumulates the on-device capture
 * quality tally. Re-renders only when the guidance message / ticks change.
 * Entirely best-effort: nothing here can affect the recording.
 */
export function useCaptureAnalysis({ pose, view, available, rollRef, pitchRef }: Options) {
  const [guidance, setGuidance] = useState<Guidance>(unavailableGuidance);
  const [telemetry, setTelemetry] = useState<Telemetry>(EMPTY_TELEMETRY);
  const lastTelemetry = useRef(0);
  const keyRef = useRef("");
  const tracker = useRef(new MotionTracker()).current;
  const acc = useRef<SqiAccumulator | null>(null);
  const lastStreak = useRef(0);
  const steadyNow = useRef(false);
  const wasSteady = useRef(false);
  const lastN = useRef(-1);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    tracker.reset();
    lastN.current = -1;
    wasSteady.current = false;
  }, [view, available, tracker]);

  useEffect(() => {
    const publish = (g: Guidance) => {
      const key = `${g.available}|${g.message}|${g.span === null ? "-" : Math.round(g.span * 100)}|${g.checks.map((c) => (c.ok ? 1 : 0)).join("")}`;
      if (key !== keyRef.current) {
        keyRef.current = key;
        setGuidance(g);
      }
    };
    if (!available) {
      publish(unavailableGuidance());
      setTelemetry(EMPTY_TELEMETRY);
      return;
    }
    const id = setInterval(() => {
      try {
        const snap = pose.value;
        if (!(snap.w > 0)) return;
        const n = snap.n ?? 0;
        if (n === lastN.current) return; // no new camera frame since the last tick
        lastN.current = n;
        const tMs = performance.now();
        tracker.push(snap.pts, tMs);
        const motion = tracker.motion();
        const g = evaluateGuidance({ pts: snap.pts, view: viewRef.current, rollDeg: rollRef.current, pitchDeg: pitchRef.current, motion, scores: snap.scores, wasSteady: wasSteady.current });
        // Looked up by id, not by position: `checks[5]` was "steady" only
        // because of the order of an array in another module. Both paths that
        // build `checks` emit all six, so `?? false` is unreachable - and if it
        // ever were reached, "not steady" is the direction that claims nothing.
        const steady = g.checks.find((c) => c.id === "steady")?.ok ?? false; // implies a person; framing is separate
        const limit = wasSteady.current ? STEADY_THRESHOLD * STEADY_RELEASE_FACTOR : STEADY_THRESHOLD;
        wasSteady.current = steady;
        if (tMs - lastTelemetry.current >= TELEMETRY_MS) {
          lastTelemetry.current = tMs;
          setTelemetry({
            rollDeg: rollRef.current,
            pitchDeg: pitchRef.current,
            span: g.span,
            motion,
            steadyLimit: limit,
            confidence: g.personOk ? snap.conf ?? null : null,
            visiblePoints: visibleCount(snap.pts),
          });
        }
        steadyNow.current = steady && g.inFrame && g.personOk;
        publish(g);
        const a = acc.current;
        if (a) {
          addFrame(a, {
            tMs, confident: g.personOk, inFrame: g.inFrame, conf: snap.conf ?? 0, steady, rollDeg: rollRef.current,
          });
          const streak = a.streakStartMs !== null ? (tMs - a.streakStartMs) / 1000 : 0;
          lastStreak.current = streak;
        }
      } catch {
        // Analysis is best-effort; never surface errors to the capture flow.
      }
    }, SAMPLE_MS);
    return () => clearInterval(id);
  }, [available, pose, rollRef, pitchRef, tracker]);

  const beginRecording = useCallback(() => {
    acc.current = emptyAccumulator();
    lastStreak.current = 0;
  }, []);

  /** Stops accumulating and returns the final summary (SQI null when the pose guide produced too few frames). */
  const endRecording = useCallback((): SqiSummary => {
    const a = acc.current;
    acc.current = null;
    return summarise(a ?? emptyAccumulator());
  }, []);

  const getLive = useCallback((): LiveStats => {
    const a = acc.current ?? emptyAccumulator();
    const s = summarise(a);
    return { ...s, streakSeconds: lastStreak.current, steadyNow: steadyNow.current };
  }, []);

  return { guidance, telemetry, beginRecording, endRecording, getLive };
}
