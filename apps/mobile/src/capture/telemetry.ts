import { DISTANCE_MAX, DISTANCE_MIN, MIN_KEY_SCORE, PITCH_TOLERANCE_DEG, ROLL_TOLERANCE_DEG } from "./guidance";
import type { Telemetry } from "./use-capture-analysis";

export type TelemetryTone = "ok" | "warn" | "unknown";

export interface TelemetryRow {
  key: string;
  label: string;
  value: string;
  /** What the value is judged against, in words. */
  target: string;
  tone: TelemetryTone;
}

const dash = "–";

/**
 * Rows for the capture screen's live sensor readout. Pure, so it can be tested
 * without a camera. Every reading that is unavailable reads as a dash with tone
 * "unknown" - never as 0 and never as OK. Filming conditions only: nothing here
 * describes the person's posture.
 */
export function telemetryRows(t: Telemetry): TelemetryRow[] {
  const roll = t.rollDeg;
  const pitch = t.pitchDeg;
  const span = t.span;
  const motion = t.motion;
  return [
    {
      key: "roll",
      label: "Side tilt",
      value: roll === null ? dash : `${roll.toFixed(1)}°`,
      target: `within ±${ROLL_TOLERANCE_DEG}°`,
      tone: roll === null ? "unknown" : Math.abs(roll) <= ROLL_TOLERANCE_DEG ? "ok" : "warn",
    },
    {
      key: "pitch",
      label: "Forward tilt",
      value: pitch === null ? dash : `${pitch.toFixed(1)}°`,
      target: `at most ${PITCH_TOLERANCE_DEG}°`,
      tone: pitch === null ? "unknown" : pitch <= PITCH_TOLERANCE_DEG ? "ok" : "warn",
    },
    {
      key: "distance",
      label: "Body height in frame",
      value: span === null ? dash : `${Math.round(span * 100)}%`,
      target: `${Math.round(DISTANCE_MIN * 100)}–${Math.round(DISTANCE_MAX * 100)}%`,
      tone: span === null ? "unknown" : span >= DISTANCE_MIN && span <= DISTANCE_MAX ? "ok" : "warn",
    },
    {
      key: "motion",
      label: "Hip movement",
      // Shown in per-mille of frame height: 0.012 reads as 12, easier to watch than 0.012.
      value: motion === null ? dash : `${(motion * 1000).toFixed(0)}`,
      target: `under ${(t.steadyLimit * 1000).toFixed(0)}`,
      tone: motion === null ? "unknown" : motion <= t.steadyLimit ? "ok" : "warn",
    },
    {
      key: "confidence",
      label: "Pose tracking",
      value: t.confidence === null ? dash : `${Math.round(t.confidence * 100)}% · ${t.visiblePoints}/17 points`,
      target: "pose guide confidence",
      tone: t.confidence === null ? "unknown" : t.confidence >= MIN_KEY_SCORE ? "ok" : "warn",
    },
  ];
}
