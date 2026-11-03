/**
 * In-memory on-device capture stats per clip, for the analysis screen to read.
 * ON-DEVICE PRE-CHECK values only (see sqi.ts): not persisted, not uploaded,
 * lost when the app restarts, and not a clinical result.
 */
import { pitchDegrees, rollDegrees } from "./level";
import type { GravitySample } from "./gravity";
import type { SqiBand } from "./sqi";

export interface ClipStats {
  sqi: number | null;
  band: SqiBand | null;
  stars: 1 | 2 | 3 | null;
  framesAnalysed: number;
  framesKept: number;
  framesFiltered: number;
  longestSteadySeconds: number;
  /** Mean signed phone roll over the clip's gravity samples; null if none had a valid roll. */
  meanRollDegrees: number | null;
  /** Median forward/back tilt over the clip's gravity samples (the server rejects above 12); optional for older records. */
  meanPitchDegrees?: number | null;
}

const store = new Map<string, Map<string, ClipStats>>();

/** Mean of rollDegrees over the recorded gravity samples (null when none is valid). */
export function meanRollFromSamples(samples: readonly GravitySample[]): number | null {
  let sum = 0;
  let n = 0;
  for (const s of samples) {
    const r = rollDegrees(s.g);
    if (r !== null && Number.isFinite(r)) {
      sum += r;
      n++;
    }
  }
  return n > 0 ? sum / n : null;
}

/** Median of pitchDegrees over the recorded gravity samples (null when none is valid). */
export function medianPitchFromSamples(samples: readonly GravitySample[]): number | null {
  const v: number[] = [];
  for (const s of samples) {
    const p = pitchDegrees(s.g);
    if (p !== null && Number.isFinite(p)) v.push(p);
  }
  if (v.length === 0) return null;
  v.sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function recordClipStats(sessionId: string, stepId: string, stats: ClipStats): void {
  let session = store.get(sessionId);
  if (!session) store.set(sessionId, (session = new Map()));
  session.set(stepId, { ...stats });
}

export function getClipStats(sessionId: string, stepId: string): ClipStats | undefined {
  const s = store.get(sessionId)?.get(stepId);
  return s ? { ...s } : undefined;
}

/** All stats for a session as [stepId, stats] in the order they were recorded. */
export function getSessionStats(sessionId: string): [string, ClipStats][] {
  return [...(store.get(sessionId)?.entries() ?? [])].map(([k, v]) => [k, { ...v }]);
}

export function clearSessionStats(sessionId?: string): void {
  if (sessionId === undefined) store.clear();
  else store.delete(sessionId);
}
