/**
 * Pure maths for the live pose-guide skeleton.
 *
 * ALIGNMENT AID ONLY. The skeleton comes from an on-device MoveNet model and
 * exists so the person filming can see whether the subject is framed. It is
 * NOT a measurement and must never be shown or described as one: the angles
 * in the results come from the server's MediaPipe analysis of the recorded
 * clip. MoveNet is single-person, so other people in frame can confuse it.
 *
 * Functions carry a 'worklet' directive because they run inside the camera
 * frame-output worklet and in Reanimated animated props (UI thread).
 */

/**
 * `buf[i]`, with an out-of-range index read as NaN. See `sample` in
 * `lib/required.ts` for why NaN and why it changes no behaviour.
 *
 * DUPLICATED here on purpose rather than imported. These functions run inside
 * the camera frame-output worklet and Reanimated animated props, and a worklet
 * cannot synchronously call a plain function from another module: importing
 * `sample` would type-check and pass every Jest test, then throw on device
 * ("Tried to synchronously call a non-worklet function on the UI thread"). The
 * directive below makes this one a worklet, so it is captured with its callers.
 */
function sample(buf: ArrayLike<number>, i: number): number {
  'worklet';
  return buf[i] ?? Number.NaN;
}

export const MOVENET_INPUT = 192;
export const KEYPOINT_COUNT = 17;
/** Minimum MoveNet score for a keypoint to be drawn / counted. */
export const VISIBILITY_THRESHOLD = 0.3;
/** Virtual keypoint: midpoint of the shoulders (neck base). */
export const NECK_INDEX = 17;
/** Marks a hidden keypoint in a flat [x0,y0,x1,y1,...] array. */
export const HIDDEN = -1;

/** MoveNet order: 0 nose, 1-2 eyes, 3-4 ears, 5-6 shoulders, 7-8 elbows, 9-10 wrists, 11-12 hips, 13-14 knees, 15-16 ankles. */
export const BONES: readonly (readonly [number, number])[] = [
  [5, 6],
  [5, 7],
  [7, 9],
  [6, 8],
  [8, 10],
  [5, 11],
  [6, 12],
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [0, NECK_INDEX],
];

/** Normalised (0-1) upright-frame keypoints plus the upright frame size they refer to. */
export interface PoseSnapshot {
  /** Flat [x0,y0,...] x17, normalised to the upright frame; HIDDEN when below threshold. */
  pts: number[];
  /** Upright (portrait) frame size in pixels; 0 until a frame has been processed. */
  w: number;
  h: number;
  /** Frames the model has processed so far (monotonic); lets JS tell a new frame from a re-read. */
  n?: number;
  /** MoveNet score per keypoint (17), so framing can demand comfortably confident joints. */
  scores?: number[];
  /** Mean MoveNet score of the visible keypoints in this frame (0 when none are visible). */
  conf?: number;
}

export const EMPTY_POSE: PoseSnapshot = { pts: new Array(KEYPOINT_COUNT * 2).fill(HIDDEN), w: 0, h: 0 };

/**
 * Decodes MoveNet output ([y, x, score] x17, normalised to the 192x192
 * letterboxed input) into upright-frame normalised points, undoing the
 * 'contain' padding. fw/fh are the upright frame size in pixels.
 */
export function decodeMoveNet(raw: ArrayLike<number>, fw: number, fh: number): number[] {
  'worklet';
  const size = MOVENET_INPUT;
  const s = Math.min(size / fw, size / fh);
  const rw = fw * s;
  const rh = fh * s;
  const ox = (size - rw) / 2;
  const oy = (size - rh) / 2;
  const out: number[] = new Array(KEYPOINT_COUNT * 2);
  for (let i = 0; i < KEYPOINT_COUNT; i++) {
    const score = sample(raw, i * 3 + 2);
    if (!(score >= VISIBILITY_THRESHOLD)) {
      out[2 * i] = HIDDEN;
      out[2 * i + 1] = HIDDEN;
      continue;
    }
    const x = (sample(raw, i * 3 + 1) * size - ox) / rw;
    const y = (sample(raw, i * 3) * size - oy) / rh;
    // Padding area (outside the real image) is not a valid location.
    const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
    out[2 * i] = inside ? x : HIDDEN;
    out[2 * i + 1] = inside ? y : HIDDEN;
  }
  return out;
}

/** A keypoint counts toward "a person is here" at or above this score (higher than the draw threshold). */
export const PERSON_KEYPOINT_SCORE = 0.4;
/** Fewest confident keypoints (of 17) before the frame is treated as showing a person. */
export const PERSON_MIN_POINTS = 8;
/**
 * Side-on, the far ear, shoulder, elbow, wrist, hip, knee and ankle are hidden
 * behind the body and score low, so a lateral pose can never reach the frontal
 * count or show 3 of 4 torso points.
 */
export const PERSON_MIN_POINTS_LATERAL = 6;
/** Torso keypoints: shoulders 5-6 and hips 11-12; at least this many must be confident. */
export const PERSON_MIN_TORSO_POINTS = 3;

/**
 * MoveNet is single-pose: it returns 17 keypoints for ANY image, including an
 * empty desk or a screen, with low scores. A skeleton is only drawn when the
 * frame looks like it contains a person: enough confident keypoints overall
 * and most of the torso. Without this, junk scenes show a ghost skeleton.
 */
export function personPresent(raw: ArrayLike<number>, lateral: boolean = false): boolean {
  'worklet';
  let confident = 0;
  for (let i = 0; i < KEYPOINT_COUNT; i++) if (sample(raw, i * 3 + 2) >= PERSON_KEYPOINT_SCORE) confident++;
  if (confident < (lateral ? PERSON_MIN_POINTS_LATERAL : PERSON_MIN_POINTS)) return false;
  const lSho = sample(raw, 5 * 3 + 2) >= PERSON_KEYPOINT_SCORE;
  const rSho = sample(raw, 6 * 3 + 2) >= PERSON_KEYPOINT_SCORE;
  const lHip = sample(raw, 11 * 3 + 2) >= PERSON_KEYPOINT_SCORE;
  const rHip = sample(raw, 12 * 3 + 2) >= PERSON_KEYPOINT_SCORE;
  // Side-on only the near shoulder and hip are reliable, so one of each is the
  // most a real person can offer; front-on all four are visible and demanding
  // three keeps junk scenes from drawing a ghost skeleton.
  if (lateral) return (lSho || rSho) && (lHip || rHip);
  return (lSho ? 1 : 0) + (rSho ? 1 : 0) + (lHip ? 1 : 0) + (rHip ? 1 : 0) >= PERSON_MIN_TORSO_POINTS;
}

/** Mean MoveNet score over the keypoints at or above the visibility threshold; 0 when none. */
export function meanVisibleScore(raw: ArrayLike<number>): number {
  'worklet';
  let sum = 0;
  let n = 0;
  for (let i = 0; i < KEYPOINT_COUNT; i++) {
    const s = sample(raw, i * 3 + 2);
    if (s >= VISIBILITY_THRESHOLD) {
      sum += s;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/** Per-keypoint MoveNet scores as a plain array (17). */
export function keypointScores(raw: ArrayLike<number>): number[] {
  'worklet';
  const out: number[] = new Array(KEYPOINT_COUNT);
  for (let i = 0; i < KEYPOINT_COUNT; i++) out[i] = sample(raw, i * 3 + 2);
  return out;
}

/** Number of keypoints currently visible (0-17). */
export function visibleCount(pts: readonly number[]): number {
  'worklet';
  let n = 0;
  for (let i = 0; i < KEYPOINT_COUNT; i++) if (sample(pts, 2 * i) >= 0 && sample(pts, 2 * i + 1) >= 0) n++;
  return n;
}

/**
 * Maps a normalised upright-frame point to view pixels for a 'cover' preview
 * (uniform scale, centre crop). Returns null when frame size is unknown.
 */
export function coverMap(
  u: number,
  v: number,
  frameW: number,
  frameH: number,
  viewW: number,
  viewH: number,
): [number, number] | null {
  'worklet';
  if (!(frameW > 0 && frameH > 0 && viewW > 0 && viewH > 0)) return null;
  const scale = Math.max(viewW / frameW, viewH / frameH);
  const x = (viewW - frameW * scale) / 2 + u * frameW * scale;
  const y = (viewH - frameH * scale) / 2 + v * frameH * scale;
  return [x, y];
}

/** View-space position of keypoint `index` (NECK_INDEX = shoulder midpoint), or null if hidden. */
export function jointPosition(
  snap: PoseSnapshot,
  index: number,
  viewW: number,
  viewH: number,
): [number, number] | null {
  'worklet';
  const pts = snap.pts;
  let u: number;
  let v: number;
  if (index === NECK_INDEX) {
    if (!(sample(pts, 10) >= 0 && sample(pts, 12) >= 0)) return null;
    u = (sample(pts, 10) + sample(pts, 12)) / 2;
    v = (sample(pts, 11) + sample(pts, 13)) / 2;
  } else {
    u = sample(pts, 2 * index);
    v = sample(pts, 2 * index + 1);
    if (!(u >= 0 && v >= 0)) return null;
  }
  return coverMap(u, v, snap.w, snap.h, viewW, viewH);
}

/** View-space segment for a bone; null when either end is hidden. */
export function boneSegment(
  snap: PoseSnapshot,
  bone: readonly [number, number],
  viewW: number,
  viewH: number,
): [number, number, number, number] | null {
  'worklet';
  const a = jointPosition(snap, bone[0], viewW, viewH);
  const b = jointPosition(snap, bone[1], viewW, viewH);
  if (!a || !b) return null;
  return [a[0], a[1], b[0], b[1]];
}

export type PoseModelState = "loading" | "loaded" | "error";

/** Honest label for the header pill; never claims more points than detected. */
export function poseStatusText(modelState: PoseModelState, resizerFailed: boolean, count: number): string {
  if (modelState === "error" || resizerFailed) return "Pose guide unavailable";
  if (modelState === "loading" || count <= 0) return "Pose guide · looking for a person";
  if (count >= KEYPOINT_COUNT) return `Pose guide · ${KEYPOINT_COUNT} points`;
  return `Pose guide · ${count} of ${KEYPOINT_COUNT} points`;
}
