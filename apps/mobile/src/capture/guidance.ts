/**
 * Live capture guidance: pure logic, computed from the on-device pose guide's
 * keypoints (MoveNet, normalised upright-frame coordinates, HIDDEN = -1).
 *
 * ALIGNMENT AID ONLY. These checks tell the person filming whether the subject
 * is framed well enough to record. They say nothing about the subject's
 * posture and never use cm or degree claims about the body; the only numbers
 * ever surfaced are the PHONE's own tilt angles, which comes from the gravity sensor.
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
import { sample } from "../lib/required";
import { HIDDEN, visibleCount } from "./pose-overlay";

export type GuidanceView = "anterior" | "posterior" | "left_lateral" | "right_lateral";

/** Visible-point minimum for "person detected". */
export const MIN_POINTS_FRONTAL = 10;
export const MIN_POINTS_LATERAL = 6;
/**
 * SAFE INNER BOX. The server's frame gate (ml-service clip_quality.py,
 * FRAME_MARGIN_FRACTION = 0.02, MIN_VISIBILITY = 0.5) only uses a frame if EVERY
 * required MediaPipe landmark (nose; both sides' ear, shoulder, hip, knee, ankle
 * and HEEL for frontal views, near side + nose for lateral views) lies inside
 * [2 %, 98 %] of the frame in both axes and is visible. The on-device MoveNet
 * guide has no heel points, so the box is deliberately tighter than the server:
 */
/** Head points (nose, ears) must be at or below this y: head not cut off (server: >= 0.02). */
export const SAFE_HEAD_Y_MIN = 0.05;
/** MediaPipe heels sit about 0.04-0.06 of the frame below the ankle. */
export const HEEL_ALLOWANCE_Y = 0.06;
/** Ankles must be at or above this y so heels stay under 0.96 < server 0.98. */
export const SAFE_ANKLE_Y_MAX = 0.9;
/** Ear/shoulder/hip/knee/ankle x must lie inside [SAFE_X_MIN, SAFE_X_MAX] (server: [0.02, 0.98]). */
export const SAFE_X_MIN = 0.05;
export const SAFE_X_MAX = 0.95;
/**
 * Required keypoints need a MoveNet score at least this (person threshold is
 * 0.4, draw threshold 0.3) so that occlusion, which the server sees as
 * visibility < 0.5, is less likely.
 */
export const MIN_KEY_SCORE = 0.45;
/**
 * Target for the lowest ankle point when standing in the band, and where the
 * on-screen outline's feet end: SAFE_ANKLE_Y_MAX minus a margin.
 */
export const BAND_FEET_Y = 0.88;
/** Nominal head-keypoint y when standing at the near edge of the band (SAFE_HEAD_Y_MIN + margin). */
const BAND_HEAD_Y_NEAR = SAFE_HEAD_Y_MIN + 0.05;
/**
 * Keypoint span (highest head point to lowest ankle) as a fraction of frame
 * height. Keypoints sit inside the body, so this reads ~10% under true height.
 * The near limit puts the head at BAND_HEAD_Y_NEAR with the ankles on BAND_FEET_Y,
 * so a person inside the band, feet near BAND_FEET_Y, satisfies the safe box.
 */
export const DISTANCE_MAX = BAND_FEET_Y - BAND_HEAD_Y_NEAR; // 0.78
export const DISTANCE_MIN = 0.55;
/** Torso midpoint may be this far from the horizontal frame centre (fraction of frame width). */
export const CENTRE_TOLERANCE = 0.08;
/**
 * Left-right tilt (roll) tolerance, degrees. Used by BOTH the guidance "Level"
 * check and the bubble level's green zone. Small because the server
 * roll-corrects every frame, so a few degrees of roll are harmless.
 */
export const ROLL_TOLERANCE_DEG = 3;
/**
 * Pre-record forward/back tilt (pitch) tolerance, degrees. Also shared by the
 * guidance and the bubble level. The server rejects a clip as camera_not_level
 * above 2 x levelToleranceDegrees = 12 degrees using the same pitch formula;
 * 5 leaves a wide margin for drift while recording.
 */
export const PITCH_TOLERANCE_DEG = 5;
/** RMS keypoint wander (fraction of frame height) over the window below which the subject is "steady". */
export const STEADY_THRESHOLD = 0.012;
/**
 * Once steady, the subject stays "steady" until wander exceeds this multiple of
 * STEADY_THRESHOLD (hysteresis), so a breath does not flip the check off and on.
 */
export const STEADY_RELEASE_FACTOR = 1.3;
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
  /** Head-to-ankle keypoint span (fraction of frame height) for the distance meter; null when unknown. */
  span: number | null;
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
  return sample(pts, 2 * i) >= 0 && sample(pts, 2 * i + 1) >= 0;
}

/**
 * MoveNet indices for one side of the body, in the fixed order
 * [ear, shoulder, hip, knee, ankle]. A tuple, not `number[]`: the slots are
 * positional (`side[4]` IS the ankle), and typing the length means those reads
 * need no bounds check that could never fail.
 */
type BodySide = readonly [ear: number, shoulder: number, hip: number, knee: number, ankle: number];
const LEFT_SIDE: BodySide = [3, 5, 11, 13, 15];
const RIGHT_SIDE: BodySide = [4, 6, 12, 14, 16];

function visibleSide(pts: readonly number[]): BodySide {
  let l = 0;
  let r = 0;
  for (const i of LEFT_SIDE) if (seen(pts, i)) l++;
  for (const i of RIGHT_SIDE) if (seen(pts, i)) r++;
  return r > l ? RIGHT_SIDE : LEFT_SIDE;
}

/**
 * MoveNet keypoints matching the server's required landmarks: the nose, plus
 * for frontal views both sides' ear/shoulder/hip/knee/ankle, for lateral views
 * the near side's (the side with more visible points).
 */
export function requiredKeypoints(pts: readonly number[], view: string): number[] {
  if (isLateral(view)) return [0, ...visibleSide(pts)];
  return [0, ...LEFT_SIDE, ...RIGHT_SIDE];
}

export type FramingProblem = "feet" | "head" | "left" | "right" | "wide";

export interface Framing {
  ok: boolean;
  /** Highest-priority problem when not ok (feet, head, then sides). */
  problem: FramingProblem | null;
}

/**
 * SINGLE SOURCE OF TRUTH for "in frame" (guidance, messages and SQI inFrame).
 * Every required keypoint must be detected with score >= MIN_KEY_SCORE (when
 * scores are supplied) and inside the safe box. `left`/`right` are the SCREEN
 * side the person is too close to.
 */
export function checkFraming(pts: readonly number[], view: string, scores?: readonly number[]): Framing {
  let feet = false;
  let head = false;
  let left = false;
  let right = false;
  for (const i of requiredKeypoints(pts, view)) {
    const isHead = i <= 4;
    const isAnkle = i === 15 || i === 16;
    if (!seen(pts, i) || (scores !== undefined && !(sample(scores, i) >= MIN_KEY_SCORE))) {
      // Missing or low-confidence: attribute to the end of the body it belongs to.
      if (isAnkle) feet = true;
      else if (isHead) head = true;
      else { feet = true; head = true; }
      continue;
    }
    const x = sample(pts, 2 * i);
    const y = sample(pts, 2 * i + 1);
    if (isAnkle && y > SAFE_ANKLE_Y_MAX) feet = true;
    if (y < SAFE_HEAD_Y_MIN) head = true;
    if (x < SAFE_X_MIN) left = true;
    if (x > SAFE_X_MAX) right = true;
    if (!isAnkle && y > SAFE_ANKLE_Y_MAX) feet = true;
  }
  const problem: FramingProblem | null = feet ? "feet" : head ? "head" : left && right ? "wide" : left ? "left" : right ? "right" : null;
  return { ok: problem === null, problem };
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
      sum += sample(pts, 2 * i);
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
  const top = Math.min(...b.head.map((i) => sample(pts, 2 * i + 1)));
  const bottom = Math.max(...ankles.map((i) => sample(pts, 2 * i + 1)));
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
  /** The steady check passed on the previous evaluation (enables the release hysteresis). */
  wasSteady?: boolean;
  /** MoveNet score per keypoint (17). When given, required keypoints must reach MIN_KEY_SCORE. */
  scores?: readonly number[];
}

function framingMessage(problem: FramingProblem | null): string {
  switch (problem) {
    case "feet": return "Step back — your feet are cut off";
    case "head": return "Step back — your head is cut off";
    // The person is too close to this edge of the screen: move toward the other side.
    case "left": return "Move toward the right of the screen";
    case "right": return "Move toward the left of the screen";
    default: return "Step back a little";
  }
}

export type DistanceState = "none" | "far" | "good" | "close";

/** Where the person is relative to the distance band, from the keypoint span (null = no person / ends hidden). */
export function distanceState(span: number | null): DistanceState {
  if (span === null || !Number.isFinite(span)) return "none";
  if (span < DISTANCE_MIN) return "far";
  if (span > DISTANCE_MAX) return "close";
  return "good";
}

/**
 * Head-to-ankle span for the distance meter: the SAME bodySpan guidance uses,
 * but only while a person is detected (enough visible points). Unlike the
 * distance check it does not require the whole body to be inside the frame, so
 * the meter can still show where the person stands.
 */
export function distanceReading(pts: readonly number[], view: string): { span: number | null; state: DistanceState } {
  const personOk = visibleCount(pts) >= (isLateral(view) ? MIN_POINTS_LATERAL : MIN_POINTS_FRONTAL);
  const span = personOk ? bodySpan(pts, view) : null;
  return { span, state: distanceState(span) };
}

export function unavailableGuidance(): Guidance {
  return {
    available: false,
    checks: ORDER.map((id) => ({ id, label: CHECK_LABELS[id], ok: false })),
    message: UNAVAILABLE_MESSAGE,
    aligned: false,
    inFrame: false,
    personOk: false,
    span: null,
  };
}

export function evaluateGuidance(input: GuidanceInput): Guidance {
  const { pts, view, rollDeg, pitchDeg, motion, scores } = input;
  const lateral = isLateral(view);
  const personOk = visibleCount(pts) >= (lateral ? MIN_POINTS_LATERAL : MIN_POINTS_FRONTAL);

  const body = bodyFor(pts, view);
  const framing = checkFraming(pts, view, scores);
  const wholeBody = personOk && body.head.length > 0 && body.torso.every((i) => seen(pts, i)) && framing.ok;

  const span = wholeBody ? bodySpan(pts, view) : null;
  const tooFar = span !== null && span < DISTANCE_MIN;
  const tooClose = span !== null && span > DISTANCE_MAX;
  const distanceOk = span !== null && !tooFar && !tooClose;

  const cx = wholeBody ? torsoCentreX(pts, body.torso) : null;
  const offset = cx === null ? null : cx - 0.5;
  const centredOk = offset !== null && Math.abs(offset) <= CENTRE_TOLERANCE;

  const pitchKnown = pitchDeg !== null && Number.isFinite(pitchDeg);
  const pitchOk = pitchKnown && pitchDeg! <= PITCH_TOLERANCE_DEG;
  const levelOk = rollDeg !== null && Math.abs(rollDeg) <= ROLL_TOLERANCE_DEG && pitchOk;
  const steadyLimit = input.wasSteady ? STEADY_THRESHOLD * STEADY_RELEASE_FACTOR : STEADY_THRESHOLD;
  const steadyOk = personOk && motion !== null && motion <= steadyLimit;

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
  else if (!wholeBody) message = framingMessage(framing.problem);
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
    span: distanceReading(pts, view).span,
  };
}

/**
 * Keypoints that represent whole-body motion: the hips. Nose and shoulders were
 * included before, but breathing lifts the shoulders and the head nods with it,
 * so a subject standing still failed "Hold still" on every breath. The server's
 * stillness gate (clip_quality.py) also uses the hip midpoint.
 */
const MOTION_POINTS = [11, 12];

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
      ref.push(seen(pts, i) ? sample(pts, 2 * i) : HIDDEN, seen(pts, i) ? sample(pts, 2 * i + 1) : HIDDEN);
    }
    this.samples.push({ t: tMs, pts: ref });
    // Drop samples that have aged out of the window, oldest first. Same loop as
    // `while (length > 0 && tMs - samples[0].t > W) shift()`, with the first
    // element read once per pass so the empty case and the age test share one
    // `undefined` check.
    for (
      let oldest = this.samples[0];
      oldest !== undefined && tMs - oldest.t > STEADY_WINDOW_MS;
      oldest = this.samples[0]
    ) {
      this.samples.shift();
    }
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
      if (!s.every((x) => sample(x.pts, 2 * k) >= 0)) continue;
      let mx = 0;
      let my = 0;
      for (const x of s) {
        mx += sample(x.pts, 2 * k);
        my += sample(x.pts, 2 * k + 1);
      }
      mx /= s.length;
      my /= s.length;
      for (const x of s) {
        total += (sample(x.pts, 2 * k) - mx) ** 2 + (sample(x.pts, 2 * k + 1) - my) ** 2;
        count++;
      }
    }
    return count === 0 ? null : Math.sqrt(total / count);
  }
}
