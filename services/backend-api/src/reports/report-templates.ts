import type { QualityReason, Tier } from "../battery/types";
import type { Position, ReferenceBounds } from "./report-position";

/**
 * Fixed, reviewed analysis sentences for report rows (ADR-015). A template is
 * chosen by (position, tier) and filled only with the row's own numbers - no
 * free text, no interpretation, no condition names. Every template is rendered
 * by report-templates.spec.ts against references/banned-phrases.json.
 */

export type TemplateId =
  | "measured.within"
  | "measured.below"
  | "measured.above"
  | "measured.indeterminate"
  | "measured.no_reference"
  | "proxy.within"
  | "proxy.below"
  | "proxy.above"
  | "proxy.indeterminate"
  | "proxy.no_reference"
  | "annotated.no_reference"
  | "unsupported"
  | "not_measurable";

export const ALL_TEMPLATE_IDS: readonly TemplateId[] = [
  "measured.within",
  "measured.below",
  "measured.above",
  "measured.indeterminate",
  "measured.no_reference",
  "proxy.within",
  "proxy.below",
  "proxy.above",
  "proxy.indeterminate",
  "proxy.no_reference",
  "annotated.no_reference",
  "unsupported",
  "not_measurable",
];

const MEASURED_TEMPLATES = {
  within: "{value} ± {u}; within the {ref} reference.",
  below: "{value} ± {u}; below the {ref} reference by about {d}.",
  above: "{value} ± {u}; above the {ref} reference by about {d}.",
  indeterminate: "{value} ± {u}; the uncertainty overlaps the {ref} reference.",
  no_reference: "{value} ± {u}. No reference value is set for this measurement.",
} as const;

/**
 * Wording for a clinician-placed value. "Clinician-annotated", not "verified":
 * moving a landmark corrects the pose model's misplacement of it, but the
 * dominant errors - landmark-to-bony-landmark offset, soft tissue, clothing - are
 * static and are the same for a clinician's placement as for the model's. So the
 * row says WHO placed it and nothing about how right it is, and the uncertainty
 * beside it is the propagated one rather than the annotator's confidence.
 *
 * No reference is ever compared: a clinician_annotated result is a non-default
 * method, and the reference ranges are written for the 2D one.
 */
const ANNOTATED_TEMPLATE =
  "{value} ± {u}. Landmark positions were adjusted by a clinician. No reference value is set for this measurement.";

const PROXY_SUFFIX = " Proxy measurement: describes landmark geometry only.";
const UNSUPPORTED_TEMPLATE = "Not measured: {reasons}.";
const NOT_MEASURABLE_TEMPLATE = "Not measurable with this system: {reason}";

/** Plain-language wording for each quality-gate reason (quality-gate-flag.schema.json $defs.reason). */
export const REASON_WORDS: Record<QualityReason, string> = {
  insufficient_landmarks: "body landmarks were not detected well enough",
  insufficient_scale: "no scale reference was available",
  identity_uncertain: "the person could not be tracked reliably",
  anchor_drift: "the camera reference drifted",
  low_confidence: "landmark confidence was too low",
  occlusion: "part of the body was hidden",
  wrong_view: "the body was not facing the way this step needs",
  out_of_frame: "part of the body was outside the picture",
  camera_not_level: "the camera was not level",
  insufficient_frame_rate: "the frame rate was too low",
  insufficient_frames: "there were too few usable video frames",
  subject_moving: "the person moved during the hold",
  // Depth reasons (quality-gate-flag/v1). Phrased like the rest: what happened
  // to the MEASUREMENT, in plain words, with no clinical claim and no blame on
  // the patient. "depth sensor" is said plainly because the consent copy names
  // it too, so a reader meeting the phrase here has already seen it.
  depth_unavailable: "the depth sensor recording was not available",
  insufficient_depth_samples: "the depth sensor returned too few readings on the body",
  depth_landmark_disagreement: "the depth readings at one body point were not consistent",
  torso_plane_underdetermined: "the trunk landmarks were too close to a straight line to measure from",
};

const UNIT_SUFFIX: Record<string, string> = {
  deg: "°",
  cm: " cm",
  percent_stature: "% of stature",
  s: " s",
  count: "",
  per_min: " per min",
  percent: "%",
  none: "",
};

function unitSuffix(unit: string): string {
  const suffix = UNIT_SUFFIX[unit];
  if (suffix === undefined) throw new Error(`No display form for unit "${unit}"`);
  return suffix;
}

/** One decimal place, never "-0.0". */
export function formatValue(value: number, unit: string): string {
  let text = value.toFixed(1);
  if (/^-0\.0$/.test(text)) text = "0.0";
  return `${text}${unitSuffix(unit)}`;
}

/** Reference numbers as written in the reference file (up to 2 decimals, no padding). */
function formatReferenceNumber(value: number, unit: string): string {
  const text = String(Number(value.toFixed(2)));
  return `${text === "-0" ? "0" : text}${unitSuffix(unit)}`;
}

export function formatReferenceLabel(reference: ReferenceBounds, unit: string): string {
  if (reference.lo === reference.hi) return formatReferenceNumber(reference.lo, unit);
  return `${formatReferenceNumber(reference.lo, unit)} to ${formatReferenceNumber(reference.hi, unit)}`;
}

export interface TemplateInput {
  tier: Tier;
  /**
   * For tier "annotated" only: the tier the catalog gives the underlying
   * quantity. A clinician moving landmarks does not turn a proxy into an
   * estimate, so a proxy still carries its caveat.
   */
  underlyingTier?: Tier;
  unit: string;
  position: Position;
  estimate: { value: number; uncertainty: number } | null;
  reference: ReferenceBounds | null;
  unsupportedReasons?: QualityReason[];
  notMeasurableReason?: string;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`Template placeholder ${match} has no value`);
    return value;
  });
}

export function renderAnalysis(input: TemplateInput): { templateId: TemplateId; text: string } {
  if (input.tier === "annotated") {
    const { estimate } = input;
    if (!estimate) throw new Error("An annotated row needs its annotated value");
    if (input.position !== "no_reference") {
      // Unreachable through report-builder, which refuses an annotated result
      // whose method is not clinician_annotated. Asserted so a reference
      // comparison can never be rendered for a clinician's placement by a caller
      // that bypassed it.
      throw new Error(`An annotated row cannot carry position "${input.position}"; it has no reference comparison`);
    }
    const text =
      fill(ANNOTATED_TEMPLATE, {
        value: formatValue(estimate.value, input.unit),
        u: formatValue(estimate.uncertainty, input.unit),
      }) + (input.underlyingTier === "proxy" ? PROXY_SUFFIX : "");
    return { templateId: "annotated.no_reference", text };
  }

  if (input.position === "not_applicable") {
    if (input.unsupportedReasons && input.unsupportedReasons.length > 0) {
      const reasons = input.unsupportedReasons.map((r) => {
        const words = REASON_WORDS[r];
        if (!words) throw new Error(`No plain wording for quality reason "${r}"`);
        return words;
      });
      return { templateId: "unsupported", text: fill(UNSUPPORTED_TEMPLATE, { reasons: reasons.join("; ") }) };
    }
    if (input.notMeasurableReason) {
      return { templateId: "not_measurable", text: fill(NOT_MEASURABLE_TEMPLATE, { reason: input.notMeasurableReason }) };
    }
    throw new Error("A not_applicable row needs unsupported reasons or a not-measurable reason");
  }

  const { estimate, reference, unit } = input;
  if (!estimate) throw new Error(`Position "${input.position}" needs an estimate`);
  const values: Record<string, string> = {
    value: formatValue(estimate.value, unit),
    u: formatValue(estimate.uncertainty, unit),
  };
  if (input.position !== "no_reference") {
    if (!reference) throw new Error(`Position "${input.position}" needs a reference`);
    values.ref = formatReferenceLabel(reference, unit);
    if (input.position === "below") values.d = formatValue(reference.lo - estimate.value, unit);
    if (input.position === "above") values.d = formatValue(estimate.value - reference.hi, unit);
  }

  const isProxy = input.tier === "proxy";
  const text = fill(MEASURED_TEMPLATES[input.position], values) + (isProxy ? PROXY_SUFFIX : "");
  const templateId = `${isProxy ? "proxy" : "measured"}.${input.position}` as TemplateId;
  return { templateId, text };
}
