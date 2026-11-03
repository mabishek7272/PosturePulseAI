import { DISTANCE_MAX, DISTANCE_MIN, type DistanceState } from "./guidance";

/** Span range shown on the gauge (fraction of frame height); the guidance band must sit inside it. */
export const GAUGE_MIN = 0.3;
export const GAUGE_MAX = 1.0;

/** 0 = top of the track (closest / largest span), 1 = bottom (far). Null without a reading. Clamped to the track. */
export function distanceMarkerFraction(span: number | null): number | null {
  if (span === null || !Number.isFinite(span)) return null;
  const s = Math.max(GAUGE_MIN, Math.min(GAUGE_MAX, span));
  return (GAUGE_MAX - s) / (GAUGE_MAX - GAUGE_MIN);
}

/** One plain word per state; no distances are claimed. */
export function distanceLabel(state: DistanceState): string {
  switch (state) {
    case "far": return "Move closer";
    case "close": return "Step back";
    case "good": return "Good distance";
    default: return "No person";
  }
}

export function distanceTone(state: DistanceState): "green" | "amber" | "grey" {
  return state === "good" ? "green" : state === "none" ? "grey" : "amber";
}

/** Top and bottom of the green band as fractions of the track (0 = top). Derived from the guidance constants. */
export function distanceBandFractions(): { top: number; bottom: number } {
  return { top: distanceMarkerFraction(DISTANCE_MAX)!, bottom: distanceMarkerFraction(DISTANCE_MIN)! };
}
