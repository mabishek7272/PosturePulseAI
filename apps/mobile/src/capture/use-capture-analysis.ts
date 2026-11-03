import { useCallback, useEffect, useRef, useState } from "react";
import type { SharedValue } from "react-native-reanimated";
import { MotionTracker, evaluateGuidance, unavailableGuidance, type Guidance } from "./guidance";
import { milestoneHaptic } from "./haptics";
import type { PoseSnapshot } from "./pose-overlay";
import { addFrame, emptyAccumulator, milestoneCrossed, summarise, type SqiAccumulator, type SqiSummary } from "./sqi";

/** JS-side sampling rate of the pose guide's keypoints (frames are ~30 Hz; this is deliberately cheaper). */
const SAMPLE_MS = 100;

export interface LiveStats extends SqiSummary {
  /** Current continuous steady+aligned run, seconds. */
  streakSeconds: number;
  /** Subject is steady and framed right now. */
  steadyNow: boolean;
}

interface Options {
  pose: SharedValue<PoseSnapshot>;
  view: string;
  /** Pose model + resizer are running. When false nothing is analysed and no SQI is produced. */
  available: boolean;
  /** Latest phone roll in degrees (null when unknown). */
  rollRef: { current: number | null };
}

/**
 * Samples the pose guide's keypoints at ~10 Hz on the JS thread (the frame
 * worklet only writes them), runs the pure guidance checks, and - between
 * beginRecording() and endRecording() - accumulates the on-device capture
 * quality tally. Re-renders only when the guidance message / ticks change.
 * Entirely best-effort: nothing here can affect the recording.
 */
export function useCaptureAnalysis({ pose, view, available, rollRef }: Options) {
  const [guidance, setGuidance] = useState<Guidance>(unavailableGuidance);
  const keyRef = useRef("");
  const tracker = useRef(new MotionTracker()).current;
  const acc = useRef<SqiAccumulator | null>(null);
  const lastStreak = useRef(0);
  const steadyNow = useRef(false);
  const lastN = useRef(-1);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    tracker.reset();
    lastN.current = -1;
  }, [view, available, tracker]);

  useEffect(() => {
    const publish = (g: Guidance) => {
      const key = `${g.available}|${g.message}|${g.checks.map((c) => (c.ok ? 1 : 0)).join("")}`;
      if (key !== keyRef.current) {
        keyRef.current = key;
        setGuidance(g);
      }
    };
    if (!available) {
      publish(unavailableGuidance());
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
        const g = evaluateGuidance({ pts: snap.pts, view: viewRef.current, rollDeg: rollRef.current, motion });
        const steady = g.checks[5].ok; // "steady" implies a person; framing is separate
        steadyNow.current = steady && g.inFrame && g.personOk;
        publish(g);
        const a = acc.current;
        if (a) {
          addFrame(a, {
            tMs, confident: g.personOk, inFrame: g.inFrame, conf: snap.conf ?? 0, steady, rollDeg: rollRef.current,
          });
          const streak = a.streakStartMs !== null ? (tMs - a.streakStartMs) / 1000 : 0;
          if (milestoneCrossed(lastStreak.current, streak) !== null) milestoneHaptic();
          lastStreak.current = streak;
        }
      } catch {
        // Analysis is best-effort; never surface errors to the capture flow.
      }
    }, SAMPLE_MS);
    return () => clearInterval(id);
  }, [available, pose, rollRef, tracker]);

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

  return { guidance, beginRecording, endRecording, getLive };
}
