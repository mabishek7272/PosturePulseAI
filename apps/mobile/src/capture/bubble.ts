import { PITCH_TOLERANCE_DEG, ROLL_TOLERANCE_DEG } from "./guidance";

/** Degrees of tilt per axis that map to the full usable travel of the bubble (the rim). */
export const BUBBLE_FULL_SCALE_DEG = 10;

export type BubbleTone = "green" | "amber" | "grey";

/**
 * Bubble offset from the vial centre, in px, for tilt (x = left-right, y = forward-back, both signed;
 * see level.ts). A real vial's bubble rises to the HIGH side:
 *   x > 0 (right side low)  -> bubble moves LEFT   (dx < 0)
 *   y > 0 (camera up, top tilted back) -> bubble moves UP (dy < 0, screen y grows downwards)
 * 10 degrees = `travel` px on each axis; the offset is clamped radially at `travel` (the rim).
 * Unknown axes sit at the centre.
 */
export function bubbleOffset(x: number | null, y: number | null, travel: number): { dx: number; dy: number } {
  const ux = x === null || !Number.isFinite(x) ? 0 : -x / BUBBLE_FULL_SCALE_DEG;
  const uy = y === null || !Number.isFinite(y) ? 0 : -y / BUBBLE_FULL_SCALE_DEG;
  const len = Math.hypot(ux, uy);
  const k = len > 1 ? 1 / len : 1;
  return { dx: ux * k * travel + 0, dy: uy * k * travel + 0 }; // + 0 turns -0 into 0
}

/**
 * Green tolerance zone: an ellipse centred on the vial with semi-axes in the SAME scaling as the
 * bubble (10 degrees = `travel` px): horizontal = ROLL_TOLERANCE_DEG, vertical = PITCH_TOLERANCE_DEG.
 */
export function toleranceZone(travel: number): { rx: number; ry: number } {
  return { rx: (ROLL_TOLERANCE_DEG / BUBBLE_FULL_SCALE_DEG) * travel, ry: (PITCH_TOLERANCE_DEG / BUBBLE_FULL_SCALE_DEG) * travel };
}

/** Grey when a reading is unavailable (flat / no sensor), green when level (with hysteresis), otherwise amber. */
export function bubbleTone(x: number | null, y: number | null, level: boolean): BubbleTone {
  if (x === null || y === null) return "grey";
  return level ? "green" : "amber";
}
