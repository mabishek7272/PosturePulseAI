// Display helpers for assessment-report rows (ADR-015). Everything here is a
// direct, neutral rendering of what the report body already says: no value is
// derived, ranked, combined or coloured by where it falls.

import type { MeasurementMethod, MetricTier, ReportPosition, ReportSide } from "../api/types";

const UNIT_SUFFIX: Record<string, string> = {
  deg: "°",
  percent_stature: " % stature",
  cm: " cm",
  s: " s",
  per_min: " /min",
  percent: "%",
  count: "",
  none: "",
};

export function unitSuffix(unit: string): string {
  return unit in UNIT_SUFFIX ? UNIT_SUFFIX[unit] : ` ${unit}`;
}

/** Units whose values can be negative; only these get an explicit "+" so the sign reads as a direction. */
const SIGNED_UNITS: ReadonlySet<string> = new Set(["deg", "percent_stature", "cm"]);

/** One decimal normally; more when the uncertainty is small, so it never reads as exact. */
function decimalsFor(uncertainty: number): number {
  if (uncertainty === 0 || uncertainty >= 0.05) return 1;
  return uncertainty >= 0.005 ? 2 : 3;
}

function formatValue(value: number, decimals: number, showPlus: boolean): string {
  const fixed = value.toFixed(decimals);
  if (Number(fixed) === 0) return (0).toFixed(decimals);
  return showPlus && value > 0 ? `+${fixed}` : fixed;
}

function formatUncertainty(uncertainty: number, decimals: number): string {
  const fixed = uncertainty.toFixed(decimals);
  return uncertainty > 0 && Number(fixed) === 0 ? "<0.001" : fixed;
}

/**
 * "{value}{unit} ± {uncertainty}{unit}" - a value is never shown without its uncertainty.
 * A "+" is shown only for units that can be negative; what the sign means comes from the
 * row's own signConvention when the report carries one (see ReportRowsTable).
 */
export function formatMeasurement(value: number, uncertainty: number, unit: string): string {
  const suffix = unitSuffix(unit);
  const decimals = decimalsFor(uncertainty);
  return `${formatValue(value, decimals, SIGNED_UNITS.has(unit))}${suffix} ± ${formatUncertainty(uncertainty, decimals)}${suffix}`;
}

const POSITION_LABEL: Record<ReportPosition, string> = {
  below: "Below reference",
  within: "Within reference",
  above: "Above reference",
  indeterminate: "Uncertainty overlaps reference",
  no_reference: "No reference set",
  not_applicable: "No value",
};

export function positionLabel(position: ReportPosition): string {
  return POSITION_LABEL[position] ?? position;
}

const TIER_LABEL: Record<MetricTier, string> = {
  estimate: "Estimate",
  proxy: "Proxy",
  entered: "Entered",
  annotated: "Annotated",
  not_measurable: "Not measurable",
};

export function tierLabel(tier: MetricTier): string {
  return TIER_LABEL[tier] ?? tier;
}

export const TIER_HINT: Partial<Record<MetricTier, string>> = {
  estimate: "2D measurement from the video, shown with its uncertainty.",
  proxy: "Stands in for a clinical construct; compared only with a geometric reference.",
};

/** The pipeline's only implemented method this phase (ADR-018); absent means this, too (see ReportRow.method). */
export const DEFAULT_MEASUREMENT_METHOD: MeasurementMethod = "mediapipe_2d_image_plane";

const MEASUREMENT_METHOD_LABEL: Record<MeasurementMethod, string> = {
  mediapipe_2d_image_plane: "Camera estimate (2D)",
  clinician_manual: "Clinician manual measurement",
  clinician_annotated: "Clinician-annotated",
  entered: "Entered value",
  markerless_3d: "Markerless 3D (not yet implemented)",
};

export function measurementMethodLabel(method: MeasurementMethod): string {
  return MEASUREMENT_METHOD_LABEL[method] ?? method;
}

export function sideLabel(side: ReportSide): string {
  switch (side) {
    case "left":
      return "Left";
    case "right":
      return "Right";
    case "bilateral":
      return "Both sides";
    default:
      return "";
  }
}

const REASON_TEXT: Record<string, string> = {
  insufficient_landmarks: "too few body landmarks were detected",
  insufficient_scale: "no scale reference was available",
  identity_uncertain: "it was unclear which person was being measured",
  anchor_drift: "the camera reference drifted",
  low_confidence: "landmark confidence was low",
  occlusion: "part of the body was hidden",
  wrong_view: "the person was not facing the way this step needs",
  out_of_frame: "part of the body was outside the frame",
  camera_not_level: "the camera was not level",
  insufficient_frame_rate: "the video frame rate was too low",
  insufficient_frames: "too few usable video frames",
  subject_moving: "the person moved during the hold",
};

export function reasonText(reason: string): string {
  return REASON_TEXT[reason] ?? reason.replace(/_/g, " ");
}

export interface StepGroup<R> {
  stepId: string | null;
  rows: R[];
}

/** Groups rows by stepId, in the order steps first appear; rows without a stepId go last. */
export function groupRowsByStep<R extends { stepId?: string | null }>(rows: R[]): StepGroup<R>[] {
  const groups = new Map<string | null, R[]>();
  for (const row of rows) {
    const key = row.stepId ?? null;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const ordered = [...groups.entries()].filter(([key]) => key !== null);
  const unassigned = groups.get(null);
  if (unassigned) ordered.push([null, unassigned]);
  return ordered.map(([stepId, groupRows]) => ({ stepId, rows: groupRows }));
}
