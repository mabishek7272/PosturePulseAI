/**
 * Hold-feedback state machine (pure, deterministic: `now` is injected).
 *
 * Decides WHEN to nudge the person filming during the recording hold. It only
 * looks at filming conditions (steadiness, framing, distance, device tilt) and
 * never says anything about the person's posture or any clinical meaning.
 *
 * Rules (recording phase only; idle/countdown fire nothing and reset state):
 *  - one `start` event on the first recording tick
 *  - an issue must persist WARN_AFTER_MS before it can warn (a blip never does)
 *  - at least WARN_GAP_MS between any two warnings, and the same issue is not
 *    repeated more often than ISSUE_REPEAT_MS
 *  - `recovered` fires once when every issue clears after a warning, at most
 *    once per RECOVER_GAP_MS
 *  - `milestone` every 10 s of continuous steady + in-frame streak, up to the
 *    clip length (10 s and 20 s for a 30 s clip), matching sqi.ts's streak.
 */
export type Issue = "steady" | "centred" | "inFrame" | "distance" | "level" | "tilt" | "personLost";
export type Phase = "idle" | "countdown" | "recording";

export type FeedbackEvent =
  | { kind: "warn"; issue: Issue }
  | { kind: "recovered" }
  | { kind: "start" }
  | { kind: "milestone"; seconds: number };

export interface FeedbackInput {
  phase: Phase;
  issues: ReadonlySet<Issue>;
  /** ms, monotonic. */
  now: number;
}

export const WARN_AFTER_MS = 800;
export const WARN_GAP_MS = 3000;
export const ISSUE_REPEAT_MS = 6000;
export const RECOVER_GAP_MS = 5000;
export const MILESTONE_EVERY_S = 10;
/** A gap longer than this between ticks ends the streak (same as sqi.ts). */
export const STREAK_GAP_MS = 600;

/** Highest priority first. */
export const ISSUE_PRIORITY: readonly Issue[] = ["personLost", "tilt", "inFrame", "distance", "centred", "level", "steady"];

/** Short, plain, filming-conditions-only wording (caption and toast). */
export const ISSUE_TEXT: Record<Issue, string> = {
  steady: "Steady your position",
  centred: "Move to the centre",
  inFrame: "Move into the frame",
  distance: "Adjust your distance",
  level: "Level the iPad",
  tilt: "Stand the iPad upright",
  personLost: "Step into view",
};

/** Issues that break the steady streak (mirrors sqi.ts: steady && inFrame && confident). */
const STREAK_BREAKERS: readonly Issue[] = ["steady", "inFrame", "personLost"];

export interface Feedback {
  step(input: FeedbackInput): FeedbackEvent[];
  /** Top-priority issue that is persistent while a warning is unresolved, else null. */
  activeIssue(): Issue | null;
  reset(): void;
}

export function createFeedback(clipSeconds = 30): Feedback {
  let started = false;
  let since = new Map<Issue, number>();
  let lastWarnAt: number | null = null;
  let lastIssueWarn = new Map<Issue, number>();
  let warningActive = false;
  let lastRecoveredAt: number | null = null;
  let streakStart: number | null = null;
  let lastTick: number | null = null;
  let lastMilestone = 0;
  let active: Issue | null = null;

  function reset() {
    started = false;
    since = new Map();
    lastWarnAt = null;
    lastIssueWarn = new Map();
    warningActive = false;
    lastRecoveredAt = null;
    streakStart = null;
    lastTick = null;
    lastMilestone = 0;
    active = null;
  }

  function step({ phase, issues, now }: FeedbackInput): FeedbackEvent[] {
    if (phase !== "recording") {
      reset();
      return [];
    }
    const events: FeedbackEvent[] = [];
    if (!started) {
      started = true;
      events.push({ kind: "start" });
    }

    // Persistence of each issue.
    for (const k of [...since.keys()]) if (!issues.has(k)) since.delete(k);
    for (const k of issues) if (!since.has(k)) since.set(k, now);
    const persistent = ISSUE_PRIORITY.filter((i) => {
      const s = since.get(i);
      return s !== undefined && now - s >= WARN_AFTER_MS;
    });

    // Warnings.
    if (lastWarnAt === null || now - lastWarnAt >= WARN_GAP_MS) {
      const next = persistent.find((i) => {
        const t = lastIssueWarn.get(i);
        return t === undefined || now - t >= ISSUE_REPEAT_MS;
      });
      if (next) {
        events.push({ kind: "warn", issue: next });
        lastWarnAt = now;
        lastIssueWarn.set(next, now);
        warningActive = true;
      }
    }

    // Recovery.
    if (issues.size === 0 && warningActive) {
      warningActive = false;
      if (lastRecoveredAt === null || now - lastRecoveredAt >= RECOVER_GAP_MS) {
        events.push({ kind: "recovered" });
        lastRecoveredAt = now;
      }
    }
    active = warningActive ? persistent[0] ?? null : null;

    // Milestones on the steady + in-frame streak.
    const broken = STREAK_BREAKERS.some((i) => issues.has(i));
    const gap = lastTick !== null && now - lastTick > STREAK_GAP_MS;
    lastTick = now;
    if (broken || gap) {
      streakStart = broken ? null : now;
      lastMilestone = 0;
    } else {
      if (streakStart === null) streakStart = now;
      const secs = (now - streakStart) / 1000;
      const m = Math.floor(secs / MILESTONE_EVERY_S) * MILESTONE_EVERY_S;
      if (m > lastMilestone && m < clipSeconds) {
        lastMilestone = m;
        events.push({ kind: "milestone", seconds: m });
      }
    }
    return events;
  }

  return { step, activeIssue: () => active, reset };
}
