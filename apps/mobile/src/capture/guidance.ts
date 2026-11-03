/**
 * Live capture guidance: pure logic, computed from the on-device pose guide's
 * keypoints (MoveNet, normalised upright-frame coordinates, HIDDEN = -1).
 *
 * ALIGNMENT AID ONLY. These checks tell the person filming whether the subject
 * is framed well enough to record. They say nothing about the subject's
 * posture and never use cm or degree claims about the body; the only number
 * ever surfaced is the PHONE's own roll, which comes from the gravity sensor.
 * The measurement is the server's MediaPipe analysis of the recorded clip.
 *
 * Direction wording is from the SCREEN's point of view ("toward the left of the
 * screen"), because the person holding the phone and the person being filmed
 * can be different people and the preview is not mirrored.
 *
 * Pose-view awareness:
 *  - anterior / posterior: both shoulders, hips and ankles are expected, the
 *    centring check uses all four torso points, and 10+ of 17 points must be
 *    visible for "person detected".
 *  - left_lateral / right_lateral: the far side of the body is hidden by the
 *    near side, so only the side with more visible points is required (one
 *    ankle, one shoulder/hip pair), and 6+ points are enough.
 */
import { HIDDEN, visibleCount } from "./pose-overlay";

export type GuidanceView = "anterior" | "posterior" | "left_lateral" | "right_lateral";

/** Visible-point minimum for "person detected". */
export const MIN_POINTS_FRONTAL = 10;
export const MIN_POINTS_LATERAL = 6;
/**
 * Keypoint span (highest head point to lowest ankle) as a fraction of frame
 * height. Keypoints sit inside the body (nose is below the crown, ankles above
 * the soles), so the span reads ~10% under true height; the band is shifted
 * down from a 0.65-0.92 body-height band to match.
 */
export const DISTANCE_MIN = 0.6;
export const DISTANCE_MAX = 0.88;
/** Points must sit inside these margins (fraction of the frame) to count as in frame. */
export const MARGIN_X = 0.04;
export const MARGIN_Y = 0.03;
/** Torso midpoint may be this far from the horizontal frame centre (fraction of frame width). */
export const CENTRE_TOLERANCE = 0.08;
/** Phone roll tolerance, degrees. */
export const LEVEL_TOLERANCE_DEG = 2;
/**
 * Pre-record pitch (forward/back tilt) limit, degrees. The server rejects a
 * clip as camera_not_level above 2 x levelToleranceDegrees = 12 degrees using
 * the same pitch formula; warning at 8 leaves margin for drift while recording.
 */
export const PITCH_LIMIT_DEG = 8;
/** RMS keypoint wander (fraction of frame height) over the window below which the subject is "steady". */
export const STEADY_THRESHOLD = 0.012;
export const STEADY_WINDOW_MS = 1000;
/** Samples needed in the window before steadiness can be judged. */
export const STEADY_MIN_SAMPLES = 5;

export type CheckId = "person" | "frame" | "distance" | "centred" | "level" | "steady";

export interface GuidanceCheck {
  id: CheckId;
  label: string;
  ok: boolean;
}

export interface Guidance {
  /** false when the pose guide is not running: nothing can be checked and nothing is claimed. */
  available: boolean;
  checks: GuidanceCheck[];
  /** One prioritised plain message. */
  message: string;
  /** Every check passes. */
  aligned: boolean;
  /** Person detected and whole relevant body inside the frame (what SQI counts as "in frame"). */
  inFrame: boolean;
  /** Person detected with enough points (what SQI counts as "confident"). */
  personOk: boolean;
}

const CHECK_LABELS: Record<CheckId, string> = {
  person: "Person",
  frame: "In frame",
  distance: "Distance",
  centred: "Centred",
  level: "Level",
  steady: "Steady",
};
const ORDER: CheckId[] = ["person", "frame", "distance", "centred", "level", "steady"];

export const PITCH_MESSAGE = "Stand the iPad upright. It is tilted forward or back";
export const UNAVAILABLE_MESSAGE = "Pose guide unavailable. You can still record.";

export function isLateral(view: string): boolean {
  return view === "left_lateral" || view === "right_lateral";
}

function seen(pts: readonly number[], i: number): boolean {
  return pts[2 * i] >= 0 && pts[2 * i + 1] >= 0;
}

function within(pts: readonly number[], i: number): boolean {
  const x = pts[2 * i];
  const y = pts[2 * i + 1];
  return x >= MARGIN_X && x <= 1 - MARGIN_X && y >= MARGIN_Y && y <= 1 - MARGIN_Y;
}

/** MoveNet indices per side: [ear, shoulder, hip, knee, ankle]. */
const LEFT_SIDE = [3, 5, 11, 13, 15];
const RIGHT_SIDE = [4, 6, 12, 14, 16];

function visibleSide(pts: readonly number[]): readonly number[] {
  let l = 0;
  let r = 0;
  for (const i of LEFT_SIDE) if (seen(pts, i)) l++;
  for (const i of RIGHT_SIDE) if (seen(pts, i)) r++;
  return r > l ? RIGHT_SIDE : LEFT_SIDE;
}

interface Body {
  /** Indices of the head points present, the ankles and torso points that must be visible. */
  head: number[];
  ankles: number[];
  torso: number[];
}

function bodyFor(pts: readonly number[], view: string): Body {
  const head = [0, 1, 2, 3, 4].filter((i) => seen(pts, i));
  if (isLateral(view)) {
    const side = visibleSide(pts);
    return { head, ankles: [side[4]], torso: [side[1], side[2]] };
  }
  return { head, ankles: [15, 16], torso: [5, 6, 11, 12] };
}

/** Mean x of the visible torso points, or null. */
function torsoCentreX(pts: readonly number[], torso: number[]): number | null {
  let sum = 0;
  let n = 0;
  for (const i of torso) {
    if (seen(pts, i)) {
      sum += pts[2 * i];
      n++;
    }
  }
  return n > 0 ? sum / n : null;
}

/** Head-to-ankle keypoint span as a fraction of frame height, or null if either end is hidden. */
export function bodySpan(pts: readonly number[], view: string): number | null {
  const b = bodyFor(pts, view);
  const ankles = b.ankles.filter((i) => seen(pts, i));
  if (b.head.length === 0 || ankles.length === 0) return null;
  const top = Math.min(...b.head.map((i) => pts[2 * i + 1]));
  const bottom = Math.max(...ankles.map((i) => pts[2 * i + 1]));
  return bottom - top;
}

export interface GuidanceInput {
  pts: readonly number[];
  view: string;
  /** Phone roll in degrees, or null when unknown (flat / no sensor). */
  rollDeg: number | null;
  /** Phone forward/back tilt in degrees (asin(|gz|/|g|)), or null when unknown. Unknown is NOT level. */
  pitchDeg: number | null;
  /** Keypoint wander from MotionTracker, or null when not enough history. */
  motion: number | null;
}

export function unavailableGuidance(): Guidance {
  return {
    available: false,
    checks: ORDER.map((id) => ({ id, label: CHECK_LABELS[id], ok: false })),
    message: UNAVAILABLE_MESSAGE,
    aligned: false,
    inFrame: false,
    personOk: false,
  };
}

export function evaluateGuidance(input: GuidanceInput): Guidance {
  const { pts, view, rollDeg, pitchDeg, motion } = input;
  const lateral = isLateral(view);
  const personOk = visibleCount(pts) >= (lateral ? MIN_POINTS_LATERAL : MIN_POINTS_FRONTAL);

  const body = bodyFor(pts, view);
  const wholeBody =
    personOk &&
    body.head.length > 0 &&
    body.ankles.every((i) => seen(pts, i) && within(pts, i)) &&
    body.torso.every((i) => seen(pts, i)) &&
    body.head.every((i) => within(pts, i));

  const span = wholeBody ? bodySpan(pts, view) : null;
  const tooFar = span !== null && span < DISTANCE_MIN;
  const tooClose = span !== null && span > DISTANCE_MAX;
  const distanceOk = span !== null && !tooFar && !tooClose;

  const cx = wholeBody ? torsoCentreX(pts, body.torso) : null;
  const offset = cx === null ? null : cx - 0.5;
  const centredOk = offset !== null && Math.abs(offset) <= CENTRE_TOLERANCE;

  const pitchKnown = pitchDeg !== null && Number.isFinite(pitchDeg);
  const pitchOk = pitchKnown && pitchDeg! <= PITCH_LIMIT_DEG;
  const levelOk = rollDeg !== null && Math.abs(rollDeg) <= LEVEL_TOLERANCE_DEG && pitchOk;
  const steadyOk = personOk && motion !== null && motion <= STEADY_THRESHOLD;

  const ok: Record<CheckId, boolean> = {
    person: personOk,
    frame: wholeBody,
    distance: distanceOk,
    centred: centredOk,
    level: levelOk,
    steady: steadyOk,
  };

  let message: string;
  if (!personOk) message = "Looking for a person";
  else if (pitchKnown && !pitchOk) message = PITCH_MESSAGE;
  else if (!wholeBody) message = "Step back a little";
  else if (tooFar) message = "Move closer";
  else if (tooClose) message = "Step back a little";
  else if (!centredOk) message = offset! > 0 ? "Move toward the left of the screen" : "Move toward the right of the screen";
  else if (!levelOk) message = rollDeg === null || !pitchKnown ? "Hold the phone upright" : "Raise the phone level";
  else if (!steadyOk) message = "Hold still";
  else message = "Aligned. Ready when you are";

  const checks = ORDER.map((id) => ({ id, label: CHECK_LABELS[id], ok: ok[id] }));
  return {
    available: true,
    checks,
    message,
    aligned: checks.every((c) => c.ok),
    inFrame: wholeBody,
    personOk,
  };
}

/** Keypoints that represent whole-body motion: nose, shoulders, hips. */
const MOTION_POINTS = [0, 5, 6, 11, 12];

/**
 * Keeps the last ~1 s of reference keypoints and reports how much they wander.
 * Wander = RMS distance of each sample from the window mean, over the reference
 * points that were visible in every sample, in frame-height-normalised units.
 * Mutable on purpose (called ~10x per second); not shared with worklets.
 */
export class MotionTracker {
  private samples: { t: number; pts: number[] }[] = [];

  push(pts: readonly number[], tMs: number): void {
    const ref: number[] = [];
    for (const i of MOTION_POINTS) {
      ref.push(seen(pts, i) ? pts[2 * i] : HIDDEN, seen(pts, i) ? pts[2 * i + 1] : HIDDEN);
    }
    this.samples.push({ t: tMs, pts: ref });
    while (this.samples.length > 0 && tMs - this.samples[0].t > STEADY_WINDOW_MS) this.samples.shift();
  }

  reset(): void {
    this.samples = [];
  }

  /** RMS wander, or null with too few samples or no reference point visible throughout. */
  motion(): number | null {
    const s = this.samples;
    if (s.length < STEADY_MIN_SAMPLES) return null;
    let total = 0;
    let count = 0;
    for (let k = 0; k < MOTION_POINTS.length; k++) {
      if (!s.every((x) => x.pts[2 * k] >= 0)) continue;
      let mx = 0;
      let my = 0;
      for (const x of s) {
        mx += x.pts[2 * k];
        my += x.pts[2 * k + 1];
      }
      mx /= s.length;
      my /= s.length;
      for (const x of s) {
        total += (x.pts[2 * k] - mx) ** 2 + (x.pts[2 * k + 1] - my) ** 2;
        count++;
      }
    }
    return count === 0 ? null : Math.sqrt(total / count);
  }
}
