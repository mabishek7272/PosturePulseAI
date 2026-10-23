// Display helpers for assessment-report rows (ADR-015). Everything here is a
// direct, neutral rendering of what the report body already says: no value is
// derived, ranked, combined or coloured by where it falls.

import type { MetricTier, ReportPosition, ReportSide } from "../api/types";

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

function signed(value: number): string {
  const fixed = value.toFixed(1);
  if (Number(fixed) === 0) return (0).toFixed(1);
  return value > 0 ? `+${fixed}` : fixed;
}

/** "{value}{unit} ± {uncertainty}{unit}" - a value is never shown without its uncertainty. */
export function formatMeasurement(value: number, uncertainty: number, unit: string): string {
  const suffix = unitSuffix(unit);
  return `${signed(value)}${suffix} ± ${uncertainty.toFixed(1)}${suffix}`;
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
