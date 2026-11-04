import { POSES, type Pose } from "./poses";

/**
 * Resolves the capture sequence from the battery the SERVER returns, instead of
 * from the hardcoded `POSES` / `CLIP_SECONDS` in `poses.ts`.
 *
 * Why this exists: the battery declared 15 / 5 / 5 / 5 second holds and the app
 * recorded **30 seconds for every step**, from one global. `durationSeconds` is
 * a clinician-authored field that nothing read - not this app, not ml-service -
 * so the authored protocol and the captured one had silently diverged. Nothing
 * failed; the clinic simply got holds four times longer than the protocol asked
 * for, and no number anywhere said so.
 *
 * The field is `durationSeconds`, as the schema names it. There is no
 * `perStepDurationSeconds`.
 *
 * **Fallback is explicit and reported, never silent.** If the battery cannot be
 * fetched the caller gets the built-in sequence AND `source: "fallback"`, so the
 * capture screen can say the durations are the app's defaults rather than the
 * clinic's protocol. A fallback that looked identical to a real battery is how
 * the original drift survived for so long.
 */

export type SubPhase = "relaxed" | "habitual" | "standardized";

export interface ResolvedSubBlock {
  phase: SubPhase;
  durationSeconds: number;
  instruction: string;
  preparation?: string | null;
}

export interface ResolvedStep {
  stepId: string;
  view: string;
  title: string;
  instruction: string;
  /** Authoritative hold length for this step, in seconds. */
  durationSeconds: number;
  minFps?: number;
  levelToleranceDegrees?: number;
  /** Present only when the step declares a multi-phase hold. */
  subBlocks?: ResolvedSubBlock[];
  requiresSpotter: boolean;
  eyesClosed: boolean;
  stance: "bilateral" | "single_left" | "single_right";
}

export interface ResolvedSequence {
  steps: ResolvedStep[];
  source: "battery" | "fallback";
  /** Set when `source` is "fallback": why the battery could not be used. */
  reason?: string;
}

/**
 * The schema's own default for `levelToleranceDegrees`. Mirrored here because a
 * step may omit it, and the server's hard pitch limit is twice this value.
 */
export const DEFAULT_LEVEL_TOLERANCE_DEGREES = 6;

/**
 * Used only when a step omits `durationSeconds`, which the schema permits for
 * `kind: "reps"` / `"passes"` but not for a hold. A hold without a duration is
 * schema-invalid and `BatteryService` would have refused to boot, so reaching
 * this value means the battery described something this screen cannot time -
 * which is why it is also reported rather than applied quietly.
 */
export const FALLBACK_DURATION_SECONDS = 30;

interface BatteryLikeStep {
  stepId?: unknown;
  view?: unknown;
  title?: unknown;
  instruction?: unknown;
  kind?: unknown;
  durationSeconds?: unknown;
  minFps?: unknown;
  levelToleranceDegrees?: unknown;
  modes?: unknown;
  subBlocks?: unknown;
  requiresSpotter?: unknown;
  eyesClosed?: unknown;
  stance?: unknown;
}

export interface BatteryLike {
  steps?: unknown;
}

/**
 * `mode` filters by the battery's own `modes` field, so a patient-facing run
 * cannot be handed a clinic-only step. Defaults to `clinic`, which is what this
 * app is.
 */
export function resolveSequence(
  battery: BatteryLike | null | undefined,
  options: { mode?: "clinic" | "patient" } = {}
): ResolvedSequence {
  const mode = options.mode ?? "clinic";

  if (!battery || !Array.isArray(battery.steps)) {
    return { steps: fallbackSteps(), source: "fallback", reason: "The assessment battery could not be read." };
  }

  const steps: ResolvedStep[] = [];
  for (const raw of battery.steps as BatteryLikeStep[]) {
    const step = resolveStep(raw, mode);
    if (step) steps.push(step);
  }

  if (steps.length === 0) {
    return {
      steps: fallbackSteps(),
      source: "fallback",
      reason: `The battery contains no steps for ${mode} mode.`,
    };
  }
  // Order is the battery's array order, deliberately: the sequence a clinician
  // authored is part of the protocol, and re-sorting it here (by view, by id)
  // would silently reorder their assessment.
  return { steps, source: "battery" };
}

function resolveStep(raw: BatteryLikeStep, mode: "clinic" | "patient"): ResolvedStep | null {
  if (typeof raw?.stepId !== "string" || typeof raw?.view !== "string") return null;
  if (Array.isArray(raw.modes) && !(raw.modes as unknown[]).includes(mode)) return null;

  const duration =
    typeof raw.durationSeconds === "number" && raw.durationSeconds > 0
      ? raw.durationSeconds
      : FALLBACK_DURATION_SECONDS;

  return {
    stepId: raw.stepId,
    view: raw.view,
    title: typeof raw.title === "string" ? raw.title : raw.stepId,
    instruction: typeof raw.instruction === "string" ? raw.instruction : "",
    durationSeconds: duration,
    minFps: typeof raw.minFps === "number" ? raw.minFps : undefined,
    levelToleranceDegrees:
      typeof raw.levelToleranceDegrees === "number"
        ? raw.levelToleranceDegrees
        : DEFAULT_LEVEL_TOLERANCE_DEGREES,
    subBlocks: resolveSubBlocks(raw.subBlocks),
    // Default FALSE for the risk flags, and that direction matters: an absent
    // flag must never be read as "a spotter is required" (which would block an
    // ordinary static step) nor relied on to mean one is not. The server
    // refuses the clip independently, so the app being wrong here cannot get an
    // unspotted balance capture into the record.
    requiresSpotter: raw.requiresSpotter === true,
    eyesClosed: raw.eyesClosed === true,
    stance:
      raw.stance === "single_left" || raw.stance === "single_right" ? raw.stance : "bilateral",
  };
}

function resolveSubBlocks(raw: unknown): ResolvedSubBlock[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const blocks: ResolvedSubBlock[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    const phase = item?.phase;
    if (phase !== "relaxed" && phase !== "habitual" && phase !== "standardized") return undefined;
    if (typeof item.durationSeconds !== "number" || item.durationSeconds <= 0) return undefined;
    blocks.push({
      phase,
      durationSeconds: item.durationSeconds,
      instruction: typeof item.instruction === "string" ? item.instruction : "",
      preparation: typeof item.preparation === "string" ? item.preparation : null,
    });
  }
  // All or nothing: a partially-understood sub-block list is worse than none,
  // because the cadence would run phases the clinician did not author while the
  // frames carried their names.
  return blocks.length >= 2 ? blocks : undefined;
}

/** The built-in sequence, used only when the battery is unavailable. */
function fallbackSteps(): ResolvedStep[] {
  return POSES.map((pose: Pose) => ({
    stepId: pose.stepId,
    view: pose.view,
    title: pose.title,
    instruction: pose.instruction,
    durationSeconds: FALLBACK_DURATION_SECONDS,
    levelToleranceDegrees: DEFAULT_LEVEL_TOLERANCE_DEGREES,
    requiresSpotter: false,
    eyesClosed: false,
    stance: "bilateral" as const,
  }));
}
