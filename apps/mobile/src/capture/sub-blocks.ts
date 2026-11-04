import type { ResolvedSubBlock, SubPhase } from "./battery-steps";

/**
 * The multi-block cadence, as a pure function of elapsed time.
 *
 * One continuous recording carries several named sub-phases - a relaxed hold, a
 * habitual stance settled into after marching, an AR-standardised stance - and
 * this maps a moment in that recording onto the phase it belongs to.
 *
 * It is deliberately pure and has no timers of its own. The capture screen
 * already owns a clock (the recorder's own presentation timestamps, and the
 * frame callbacks), and a second independent timer would drift against it: a
 * frame could then be tagged with a phase whose UI prompt had not yet changed.
 * Everything here is derived from a single elapsed value, so the tag, the
 * countdown and the prompt cannot disagree.
 *
 * **Boundaries are half-open: `[start, end)`.** A frame landing exactly on a
 * boundary belongs to the phase that is starting, not the one that ended.
 * Arbitrary, but it has to be decided somewhere or the two phases would each
 * claim it and the frame counts would not add up.
 */

export interface SubBlockWindow {
  phase: SubPhase;
  /** Seconds from the start of the recording, inclusive. */
  startSeconds: number;
  /** Seconds from the start of the recording, exclusive. */
  endSeconds: number;
  durationSeconds: number;
  instruction: string;
  preparation?: string | null;
  /** 0-based position in the sequence. */
  index: number;
}

export interface CadenceState {
  /** Null once the recording has run past the last sub-block. */
  current: SubBlockWindow | null;
  /** Null on the final sub-block. */
  next: SubBlockWindow | null;
  /** Seconds left in the current sub-phase; 0 when finished. */
  remainingInPhase: number;
  /** Seconds left in the whole step. */
  remainingTotal: number;
  /** 0..1 through the current sub-phase. */
  phaseProgress: number;
  /** True on the first call after a boundary, so a cue fires exactly once. */
  justChanged: boolean;
}

/** Cumulative windows for a sub-block list. The ONE place offsets are computed. */
export function windowsFor(blocks: ResolvedSubBlock[]): SubBlockWindow[] {
  const windows: SubBlockWindow[] = [];
  let cursor = 0;
  blocks.forEach((block, index) => {
    windows.push({
      phase: block.phase,
      startSeconds: cursor,
      endSeconds: cursor + block.durationSeconds,
      durationSeconds: block.durationSeconds,
      instruction: block.instruction,
      preparation: block.preparation ?? null,
      index,
    });
    cursor += block.durationSeconds;
  });
  return windows;
}

export function totalSeconds(blocks: ResolvedSubBlock[]): number {
  return blocks.reduce((total, block) => total + block.durationSeconds, 0);
}

/**
 * The phase a given elapsed time falls in.
 *
 * `null` for a negative elapsed (nothing has started) and for an elapsed at or
 * past the end (the step is over). Both are refusals rather than clamps: a
 * frame arriving after the last sub-block should carry NO phase, not be
 * attributed to the final one, because it was captured while the person was no
 * longer holding anything.
 */
export function phaseAt(windows: SubBlockWindow[], elapsedSeconds: number): SubBlockWindow | null {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return null;
  // Half-open [start, end), so a frame on a boundary belongs to the phase
  // starting there.
  return windows.find((w) => elapsedSeconds >= w.startSeconds && elapsedSeconds < w.endSeconds) ?? null;
}

/**
 * Full cadence state at `elapsedSeconds`.
 *
 * `previousPhaseIndex` is what the caller last saw; pass it back in and
 * `justChanged` is true exactly on the call that crosses a boundary, so a cue
 * fires once rather than on every frame of the new phase.
 */
export function cadenceAt(
  windows: SubBlockWindow[],
  elapsedSeconds: number,
  previousPhaseIndex: number | null = null
): CadenceState {
  const total = windows.length === 0 ? 0 : windows[windows.length - 1].endSeconds;
  const current = phaseAt(windows, elapsedSeconds);
  const next = current && current.index + 1 < windows.length ? windows[current.index + 1] : null;

  if (!current) {
    return {
      current: null,
      next: null,
      remainingInPhase: 0,
      remainingTotal: Math.max(0, total - Math.max(0, elapsedSeconds)),
      phaseProgress: elapsedSeconds >= total ? 1 : 0,
      justChanged: false,
    };
  }

  const intoPhase = elapsedSeconds - current.startSeconds;
  return {
    current,
    next,
    remainingInPhase: Math.max(0, current.endSeconds - elapsedSeconds),
    remainingTotal: Math.max(0, total - elapsedSeconds),
    phaseProgress: current.durationSeconds > 0 ? Math.min(1, intoPhase / current.durationSeconds) : 1,
    justChanged: previousPhaseIndex !== current.index,
  };
}

/**
 * Tags frame times with their sub-phase, for the sidecar.
 *
 * Done at CAPTURE time from the real frame timestamps, which is the only place
 * the truth exists. The alternative - letting the analysis split the clip by the
 * declared durations - drifts with every dropped frame and every pause, and a
 * frame attributed to the wrong phase is a measurement of the wrong thing
 * rather than a missing one.
 *
 * Frames outside every window get `undefined`, not the nearest phase.
 */
export function tagFrames(
  windows: SubBlockWindow[],
  frameTimes: number[]
): Array<SubPhase | undefined> {
  return frameTimes.map((t) => phaseAt(windows, t)?.phase);
}

/** Frame counts per phase, for a capture-time sanity check. */
export function framesPerPhase(
  windows: SubBlockWindow[],
  frameTimes: number[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const window of windows) counts[window.phase] = 0;
  for (const phase of tagFrames(windows, frameTimes)) {
    if (phase) counts[phase] += 1;
  }
  return counts;
}
