import type { MetricResult } from "../api/events";

/**
 * Pure helpers for the results screen. Nothing here invents data: a metric with
 * no estimate stays explicit text, and a metric with no reference has no bar.
 */

export function unitSuffix(unit?: string): string {
  if (unit === "deg") return "°";
  if (unit === "percent_stature") return "% of height";
  return unit ? ` ${unit}` : "";
}

/**
 * Plain-language wording per quality-gate reason. Mirrors the backend's
 * REASON_WORDS (services/backend-api/src/reports/report-templates.ts) so the
 * app and the report say the same thing; an unknown code is shown as-is.
 */
export const REASON_WORDS: Record<string, string> = {
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
  depth_unavailable: "the depth sensor recording was not available",
  insufficient_depth_samples: "the depth sensor returned too few readings on the body",
  depth_landmark_disagreement: "the depth readings at one body point were not consistent",
  torso_plane_underdetermined: "the trunk landmarks were too close to a straight line to measure from",
};

export function reasonWords(reasons: string[]): string {
  return reasons.map((r) => REASON_WORDS[r] ?? r).join("; ");
}

/** One-line text form. Unmeasured rows state their reason - never blank, never zero. */
export function formatResult(result: MetricResult): string {
  if (result.estimate) {
    const { value, uncertainty } = result.estimate;
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(1)} ± ${uncertainty.toFixed(1)}${unitSuffix(result.unit)}`;
  }
  if (result.unsupported) return `Not measured — ${reasonWords(result.unsupported.reasons)}`;
  if (result.notMeasurable) return `Not measurable — ${result.notMeasurable.reason}`;
  return "No result recorded";
}

export type ResultKind = "estimate" | "unsupported" | "notMeasurable" | "none";

export function resultKind(r: MetricResult): ResultKind {
  if (r.estimate) return "estimate";
  if (r.unsupported) return "unsupported";
  if (r.notMeasurable) return "notMeasurable";
  return "none";
}

/** "static.shoulder_line_tilt" + "left" -> "Shoulder line tilt (left)". Descriptive only. */
export function metricLabel(r: Pick<MetricResult, "metricKey" | "side" | "label">): string {
  if (r.label) return r.side ? `${r.label} (${r.side})` : r.label;
  const base = r.metricKey.includes(".") ? r.metricKey.slice(r.metricKey.indexOf(".") + 1) : r.metricKey;
  const words = base.replace(/[_-]+/g, " ").trim();
  const title = words ? words.charAt(0).toUpperCase() + words.slice(1) : r.metricKey;
  return r.side ? `${title} (${r.side})` : title;
}

/** Value and uncertainty as separate strings for the card layout. */
export function formatValueParts(r: MetricResult): { value: string; uncertainty: string } | null {
  if (!r.estimate) return null;
  const { value, uncertainty } = r.estimate;
  return {
    value: `${value >= 0 ? "+" : ""}${value.toFixed(1)}${unitSuffix(r.unit)}`,
    uncertainty: `±${uncertainty.toFixed(1)}`,
  };
}

export type PositionBucket = "within" | "outside" | "unknown";

export function positionBucket(r: MetricResult): PositionBucket {
  if (!r.estimate) return "unknown";
  switch (r.position) {
    case "within": return "within";
    case "below":
    case "above": return "outside";
    default: return "unknown";
  }
}

/** Same wording as the iOS report. */
export function positionLabel(r: MetricResult): string {
  switch (r.position) {
    case "below": return "Below the reference";
    case "within": return "Within the reference";
    case "above": return "Above the reference";
    case "indeterminate": return "Overlaps the reference";
    default: return "No reference set";
  }
}

export interface Coverage {
  total: number;
  measured: number;
  unmeasured: number;
  outside: number;
  within: number;
  /** Measured metrics that have a usable reference comparison. */
  withReference: number;
}

/** Data-coverage facts only; deliberately not a score. */
export function coverage(results: MetricResult[]): Coverage {
  let measured = 0, outside = 0, within = 0;
  for (const r of results) {
    if (!r.estimate) continue;
    measured += 1;
    const b = positionBucket(r);
    if (b === "outside") outside += 1;
    if (b === "within") within += 1;
  }
  return { total: results.length, measured, unmeasured: results.length - measured, outside, within, withReference: outside + within };
}

/** Fraction (0..1) of the ring to draw: measured / total. 0 when nothing came back. */
export function ringFraction(c: Coverage): number {
  return c.total === 0 ? 0 : c.measured / c.total;
}

export function heroSummary(c: Coverage): { title: string; sub: string } {
  if (c.total === 0) return { title: "No metrics returned", sub: "Nothing to show yet" };
  const parts: string[] = [];
  if (c.withReference > 0) parts.push(`${c.outside} outside reference`);
  else parts.push("No reference comparisons");
  if (c.unmeasured > 0) parts.push(`${c.unmeasured} not measured`);
  return { title: `${c.measured} of ${c.total} measured`, sub: parts.join(" · ") };
}

export interface RegionItem { key: string; text: string; bucket: PositionBucket }

/** Real rows only: "<label> — <value>", capped, with the remaining count. */
export function regionItems(results: MetricResult[], cap = 4): { items: RegionItem[]; more: number } {
  const measured = results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !!r.estimate);
  const items = measured.slice(0, cap).map(({ r, i }) => ({
    key: `${r.metricKey}-${r.side ?? ""}-${i}`,
    text: `${metricLabel(r)} — ${formatValueParts(r)!.value}`,
    bucket: positionBucket(r),
  }));
  return { items, more: Math.max(0, measured.length - cap) };
}

export interface BarLayout {
  /** 0..1 position of the measured value along the track. */
  fill: number;
  /** 0..1 reference band, or null for a single-value reference drawn as a thin marker. */
  band: { from: number; to: number };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Map value and reference onto a 0..1 track. Returns null (empty track) when
 * the estimate or a numeric reference is missing - no range is ever assumed.
 */
export function barLayout(r: MetricResult): BarLayout | null {
  if (!r.estimate || !r.reference) return null;
  const { value } = r.estimate;
  const lo = r.reference.min ?? r.reference.value;
  const hi = r.reference.max ?? r.reference.value;
  if (lo === undefined || hi === undefined || ![value, lo, hi].every(Number.isFinite)) return null;
  const min = Math.min(value, lo, hi);
  const max = Math.max(value, lo, hi);
  const pad = (max - min || 1) * 0.25;
  const a = min - pad;
  const span = max + pad - a;
  const band = { from: clamp01((lo - a) / span), to: clamp01((hi - a) / span) };
  if (band.to - band.from < 0.02) band.to = Math.min(1, band.from + 0.02);
  return { fill: clamp01((value - a) / span), band };
}

/** Right-hand caption under the track. */
export function referenceCaption(r: MetricResult): string {
  return r.reference?.label ? `Reference ${r.reference.label}` : "No reference available";
}

/** True when the row carries a real reference comparison worth two captions. */
export function hasReferenceComparison(r: MetricResult): boolean {
  return !!r.reference && (r.position === "below" || r.position === "within" || r.position === "above" || r.position === "indeterminate");
}

/** The single caption for a measured row with no reference: said once, not twice. */
export const NO_REFERENCE_CAPTION = "No reference value is set for this measurement";
