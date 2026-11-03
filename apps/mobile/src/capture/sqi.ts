/**
 * Capture quality index (SQI, "Capture quality") - an ON-DEVICE PRE-CHECK of
 * how usable the recording conditions looked, 0-100.
 *
 * NOT a clinical score and NOT a statement about the person's posture or
 * movement: it only reflects framing, pose-guide confidence, steadiness and
 * phone level while filming. It comes from the on-device MoveNet pose guide,
 * which is an alignment aid; the measurement is the server's MediaPipe
 * analysis. When the pose guide is not running there is no SQI (null) - it is
 * never reported as 0 and never estimated.
 *
 * Per sampled frame (about 10 per second, see use-capture-analysis.ts):
 *   confident = enough keypoints above the pose-model threshold
 *               (guidance.personOk; 10 frontal / 6 lateral)
 *   inFrame   = head and required ankle(s) visible and inside the margins
 *   conf      = mean model score of the visible keypoints (0 if none)
 *   steady    = keypoint wander over the last ~1 s <= STEADY_THRESHOLD
 *   level     = |phone roll| <= 2 degrees (unknown roll counts as not level)
 * kept = confident AND inFrame; filtered out = analysed - kept.
 *
 * Over the recording, with n = frames analysed:
 *   C = confident/n, F = inFrame/n, S = steady/n, L = level/n,
 *   Q = clamp((mean conf - 0.3) / (0.7 - 0.3), 0, 1)   (0.3 is the model's
 *       visibility floor, 0.7 is "clearly seen")
 *   SQI = round(100 * (0.25 C + 0.25 F + 0.20 Q + 0.20 S + 0.10 L))
 */
import { ROLL_TOLERANCE_DEG } from "./guidance";

export const SQI_WEIGHTS = { confident: 0.25, inFrame: 0.25, conf: 0.2, steady: 0.2, level: 0.1 } as const;
export const CONF_FLOOR = 0.3;
export const CONF_GOOD = 0.7;
/** A live SQI needs at least this many analysed frames (about 1 s). */
export const MIN_FRAMES_FOR_SQI = 8;

export type SqiBand = "Low" | "Fair" | "Good" | "Excellent";

export interface FrameSample {
  /** ms on a monotonic clock. */
  tMs: number;
  confident: boolean;
  inFrame: boolean;
  conf: number;
  steady: boolean;
  rollDeg: number | null;
}

export interface SqiAccumulator {
  frames: number;
  confident: number;
  inFrame: number;
  kept: number;
  steady: number;
  level: number;
  confSum: number;
  // Steady streak: longest continuous run of (steady && inFrame && confident).
  streakStartMs: number | null;
  lastAlignedMs: number | null;
  longestStreakMs: number;
}

/** A gap longer than this between samples ends a streak (frames stopped arriving). */
const STREAK_GAP_MS = 600;

export function emptyAccumulator(): SqiAccumulator {
  return {
    frames: 0, confident: 0, inFrame: 0, kept: 0, steady: 0, level: 0, confSum: 0,
    streakStartMs: null, lastAlignedMs: null, longestStreakMs: 0,
  };
}

/** Mutates and returns `acc` (called ~10x/s). */
export function addFrame(acc: SqiAccumulator, f: FrameSample): SqiAccumulator {
  acc.frames++;
  if (f.confident) acc.confident++;
  if (f.inFrame) acc.inFrame++;
  if (f.confident && f.inFrame) acc.kept++;
  if (f.steady) acc.steady++;
  if (f.rollDeg !== null && Math.abs(f.rollDeg) <= ROLL_TOLERANCE_DEG) acc.level++;
  acc.confSum += Number.isFinite(f.conf) ? Math.max(0, f.conf) : 0;

  const aligned = f.steady && f.inFrame && f.confident;
  if (aligned) {
    const continues = acc.lastAlignedMs !== null && f.tMs - acc.lastAlignedMs <= STREAK_GAP_MS && acc.streakStartMs !== null;
    if (!continues) acc.streakStartMs = f.tMs;
    acc.lastAlignedMs = f.tMs;
    acc.longestStreakMs = Math.max(acc.longestStreakMs, f.tMs - (acc.streakStartMs ?? f.tMs));
  } else {
    acc.streakStartMs = null;
    acc.lastAlignedMs = null;
  }
  return acc;
}

export interface SqiSummary {
  /** 0-100, or null when unavailable (no / too few analysed frames). */
  sqi: number | null;
  band: SqiBand | null;
  framesAnalysed: number;
  framesKept: number;
  framesFiltered: number;
  longestSteadySeconds: number;
}

export function bandFor(sqi: number): SqiBand {
  if (sqi >= 85) return "Excellent";
  if (sqi >= 65) return "Good";
  if (sqi >= 40) return "Fair";
  return "Low";
}

/** 1-3 stars for the per-pose card. Same unavailable rule as the SQI: null, never a guess. */
export function starsFor(sqi: number | null): 1 | 2 | 3 | null {
  if (sqi === null || !Number.isFinite(sqi)) return null;
  if (sqi >= 80) return 3;
  if (sqi >= 55) return 2;
  return 1;
}

export function summarise(acc: SqiAccumulator, minFrames = MIN_FRAMES_FOR_SQI): SqiSummary {
  const n = acc.frames;
  const base = {
    framesAnalysed: n,
    framesKept: acc.kept,
    framesFiltered: n - acc.kept,
    longestSteadySeconds: Math.round(acc.longestStreakMs / 100) / 10,
  };
  if (n === 0 || n < minFrames) return { sqi: null, band: null, ...base };
  const q = Math.min(1, Math.max(0, (acc.confSum / n - CONF_FLOOR) / (CONF_GOOD - CONF_FLOOR)));
  const w = SQI_WEIGHTS;
  const raw = w.confident * (acc.confident / n) + w.inFrame * (acc.inFrame / n) + w.conf * q + w.steady * (acc.steady / n) + w.level * (acc.level / n);
  const sqi = Math.round(100 * Math.min(1, Math.max(0, raw)));
  return { sqi, band: bandFor(sqi), ...base };
}

/** Steady-streak milestones in seconds, each with a light haptic. */
export const STREAK_MILESTONES = [10, 20, 30, 40] as const;

/** The milestone newly reached when the streak moves from `prev` to `next` seconds, else null. */
export function milestoneCrossed(prev: number, next: number): number | null {
  let hit: number | null = null;
  for (const m of STREAK_MILESTONES) if (prev < m && next >= m) hit = m;
  return hit;
}

/** Elapsed whole seconds as the remaining-time readout, m:ss, never negative. */
export function formatRemaining(elapsedSeconds: number, total: number): string {
  const left = Math.max(0, Math.ceil(total - Math.max(0, elapsedSeconds)));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}
