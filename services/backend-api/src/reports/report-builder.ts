import type { AssessmentBattery, MeasurementMethod, MetricCatalog, MetricResult, QualityReason, ReferenceEntry, ReferenceRangeSet, Side, Tier } from "../battery/types";
import { bannedHits } from "./banned-phrases";
import { computePosition, type Position, type ReferenceBounds } from "./report-position";
import { formatReferenceLabel, renderAnalysis } from "./report-templates";

/**
 * Deterministic assessment-report builder (ADR-015, spec slice B). A pure
 * function: the same results, reference set and catalog always give the same
 * report. Rows describe measurements only; the clinician's own interpretation
 * goes in clinicianAssessment, which the builder never fills.
 *
 * The builder never invents anything: a metric the ml-service catalog does not
 * describe, a reference with the wrong unit or a literature reference for a
 * proxy all fail the build (ReportBuildError) instead of producing a row.
 */

export const REPORT_BUILDER_VERSION = "report-builder/v1";
export const REPORT_SCHEMA_VERSION = "assessment-report/v0";

/**
 * The only measurement method this phase's reference ranges are drawn for
 * (ADR-018: the ranges are camera-derived geometric definitions, not
 * method-aware). A result that names a *different, explicit* method is never
 * compared against these bounds - see the `no_reference` gate in buildRow. A
 * result with no `measurementMethod` at all (every result produced before
 * this provenance field existed) is treated as this default: it was, in
 * fact, always this method, since no other one was ever implemented.
 */
export const DEFAULT_MEASUREMENT_METHOD: MeasurementMethod = "mediapipe_2d_image_plane";

export class ReportBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportBuildError";
  }
}

export interface IndexedReference {
  entry: ReferenceEntry;
  bounds: ReferenceBounds;
}

export interface ReportRow {
  stepId: string | null;
  metricKey: string;
  resultId: string | null;
  label: string;
  module: MetricResult["module"];
  tier: Tier;
  unit: string;
  side: Side;
  estimate: { value: number; uncertainty: number } | null;
  unsupportedReasons?: QualityReason[];
  reference: { kind: "geometric" | "literature"; label: string; sourceCitation: string; status: "draft" | "approved"; value?: number; min?: number; max?: number } | null;
  position: Position;
  analysis: { text: string; source: "fixed_template"; templateId: string };
  excluded: { reason: string; clinicianId: string } | null;
  method?: MeasurementMethod;
  measuredBy?: { modelVersion: string; adapterVersion?: string; metricsVersion?: string };
  signConvention?: string;
}

export interface AssessmentReportBody {
  reportId: string;
  sessionId: string;
  reportVersion: number;
  supersedesReportId: string | null;
  status: "draft" | "released" | "rejected";
  rows: ReportRow[];
  notMeasurable: MetricCatalog["notMeasurable"];
  clinicianAssessment: { text: string; clinicianId: string } | null;
  signOff: { clinicianId: string; signedAt: string; contentSha256: string } | null;
  provenance: {
    schemaVersion: string;
    modelVersion: string;
    calibrationVersion: string;
    producedAt: string;
    metricsVersion?: string;
    referenceFileVersion?: string;
  };
}

export interface BuildReportInput {
  reportId: string;
  sessionId: string;
  reportVersion: number;
  supersedesReportId: string | null;
  producedAt: string;
  battery: AssessmentBattery;
  /** Already reduced to the latest result per (metricKey, side, stepId) - see selectResultsForReport. */
  results: MetricResult[];
  referenceSet: ReferenceRangeSet;
  catalog: MetricCatalog;
}

/**
 * Checks the reference set against the catalog and indexes it by metricKey.
 * Rejects (at load time, not per row) a literature reference for a proxy, a
 * unit that differs from the metric's, a reference for a metric the catalog
 * does not know and a metric with more than one reference.
 */
export function indexReferences(set: ReferenceRangeSet, catalog: MetricCatalog): Map<string, IndexedReference> {
  const metrics = new Map(catalog.metrics.map((m) => [m.metricKey, m]));
  const index = new Map<string, IndexedReference>();
  for (const entry of set.entries) {
    const metric = metrics.get(entry.metricKey);
    if (!metric) {
      throw new ReportBuildError(`${set.version}: reference for "${entry.metricKey}", which the metric catalog does not describe`);
    }
    if (index.has(entry.metricKey)) {
      throw new ReportBuildError(`${set.version}: more than one reference for "${entry.metricKey}"`);
    }
    if (metric.tier === "proxy" && entry.kind !== "geometric") {
      throw new ReportBuildError(
        `${set.version}: "${entry.metricKey}" is a proxy and may only have a geometric reference, not "${entry.kind}"`
      );
    }
    if (entry.unit !== metric.unit) {
      throw new ReportBuildError(
        `${set.version}: reference unit "${entry.unit}" for "${entry.metricKey}" differs from the metric unit "${metric.unit}"`
      );
    }
    let bounds: ReferenceBounds;
    if (typeof entry.value === "number") {
      bounds = { lo: entry.value, hi: entry.value };
    } else if (typeof entry.min === "number" && typeof entry.max === "number" && entry.min <= entry.max) {
      bounds = { lo: entry.min, hi: entry.max };
    } else {
      throw new ReportBuildError(`${set.version}: reference for "${entry.metricKey}" has no usable value or min <= max`);
    }
    index.set(entry.metricKey, { entry, bounds });
  }
  return index;
}

const SIDE_ORDER: Record<string, number> = { null: 0, left: 1, right: 2, bilateral: 3 };

function sortKey(battery: AssessmentBattery, result: MetricResult): [number, number, number, string] {
  const stepIndex = battery.steps.findIndex((s) => s.stepId === result.stepId);
  const step = stepIndex >= 0 ? battery.steps[stepIndex] : undefined;
  const metricIndex = step ? step.metricKeys.indexOf(result.metricKey) : -1;
  return [
    stepIndex >= 0 ? stepIndex : Number.MAX_SAFE_INTEGER,
    metricIndex >= 0 ? metricIndex : Number.MAX_SAFE_INTEGER,
    SIDE_ORDER[String(result.side)] ?? 9,
    `${result.stepId ?? ""}|${result.metricKey}`,
  ];
}

function compareResults(battery: AssessmentBattery) {
  return (a: MetricResult, b: MetricResult): number => {
    const ka = sortKey(battery, a);
    const kb = sortKey(battery, b);
    for (let i = 0; i < 3; i++) {
      if (ka[i] !== kb[i]) return (ka[i] as number) - (kb[i] as number);
    }
    return ka[3] < kb[3] ? -1 : ka[3] > kb[3] ? 1 : 0;
  };
}

function buildRow(
  result: MetricResult,
  catalog: Map<string, MetricCatalog["metrics"][number]>,
  references: Map<string, IndexedReference>,
  referenceStatus: "draft" | "approved"
): ReportRow {
  const metric = catalog.get(result.metricKey);
  if (!metric) {
    throw new ReportBuildError(`The metric catalog does not describe "${result.metricKey}"; refusing to invent a label`);
  }
  if (result.tier !== metric.tier && result.tier !== "not_measurable") {
    throw new ReportBuildError(`Result ${result.resultId} has tier "${result.tier}" but the catalog says "${metric.tier}"`);
  }
  if (result.unit !== metric.unit) {
    throw new ReportBuildError(`Result ${result.resultId} has unit "${result.unit}" but the catalog says "${metric.unit}"`);
  }

  // Reference ranges here are camera-derived geometric definitions, not
  // keyed by method (ADR-018). A row measured by anything other than the
  // default method is never compared against them - that comparison would
  // silently assume the two methods measure the same quantity in the same
  // way. A result with no measurementMethod at all predates this field and
  // was always this method in practice (see DEFAULT_MEASUREMENT_METHOD).
  const method = result.provenance.measurementMethod;
  const isDefaultMethod = method === undefined || method === DEFAULT_MEASUREMENT_METHOD;
  const indexed = isDefaultMethod ? references.get(result.metricKey) ?? null : null;
  const reference = indexed
    ? {
        kind: indexed.entry.kind,
        label: formatReferenceLabel(indexed.bounds, indexed.entry.unit),
        sourceCitation: indexed.entry.sourceCitation,
        status: referenceStatus,
        ...(indexed.bounds.lo === indexed.bounds.hi
          ? { value: indexed.bounds.lo }
          : { min: indexed.bounds.lo, max: indexed.bounds.hi }),
      }
    : null;

  const estimate = result.estimate ? { value: result.estimate.value, uncertainty: result.estimate.uncertainty } : null;
  const position = computePosition(estimate, indexed ? indexed.bounds : null);
  const rendered = renderAnalysis({
    tier: result.tier,
    unit: result.unit,
    position,
    estimate,
    reference: indexed ? indexed.bounds : null,
    unsupportedReasons: result.unsupported?.reasons,
    notMeasurableReason: result.notMeasurable?.reason,
  });

  const row: ReportRow = {
    stepId: result.stepId ?? null,
    metricKey: result.metricKey,
    resultId: result.resultId,
    label: metric.label,
    module: result.module,
    tier: result.tier,
    unit: result.unit,
    side: result.side,
    estimate,
    reference,
    position,
    analysis: { text: rendered.text, source: "fixed_template", templateId: rendered.templateId },
    excluded: null,
  };
  if (result.unsupported) row.unsupportedReasons = [...result.unsupported.reasons];
  if (result.estimate?.signConvention) row.signConvention = result.estimate.signConvention;
  if (method !== undefined) row.method = method;
  // Narrow provenance of the measurement itself, distinct from the report's
  // own build-time provenance below (CLAUDE.md rule 4: the report-level
  // provenance.modelVersion names the report builder, not what measured the
  // body - this is where that gets closed).
  row.measuredBy = {
    modelVersion: result.provenance.modelVersion,
    ...(result.provenance.adapterVersion !== undefined ? { adapterVersion: result.provenance.adapterVersion } : {}),
    ...(result.provenance.metricsVersion !== undefined ? { metricsVersion: result.provenance.metricsVersion } : {}),
  };
  return row;
}

/** Throws ReportBuildError when text that reaches a report row carries a banned phrase. */
function assertClean(where: string, text: string): void {
  const hits = bannedHits(text);
  if (hits.length > 0) {
    throw new ReportBuildError(`${where} contains banned wording (${hits.join(", ")}); refusing to build the report`);
  }
}

export function buildReport(input: BuildReportInput): AssessmentReportBody {
  const references = indexReferences(input.referenceSet, input.catalog);
  const catalog = new Map(input.catalog.metrics.map((m) => [m.metricKey, m]));
  const rows = [...input.results]
    .sort(compareResults(input.battery))
    .map((r) => buildRow(r, catalog, references, input.referenceSet.status));

  for (const row of rows) {
    assertClean(`Row ${row.metricKey} label`, row.label);
    assertClean(`Row ${row.metricKey} analysis`, row.analysis.text);
  }
  for (const n of input.catalog.notMeasurable) {
    assertClean(`Not-measurable entry ${n.metricKey}`, `${n.label} ${n.reason} ${n.whatWouldBeNeeded}`);
  }

  return {
    reportId: input.reportId,
    sessionId: input.sessionId,
    reportVersion: input.reportVersion,
    supersedesReportId: input.supersedesReportId,
    status: "draft",
    rows,
    notMeasurable: input.catalog.notMeasurable.map((n) => ({ ...n })),
    clinicianAssessment: null,
    signOff: null,
    provenance: {
      schemaVersion: REPORT_SCHEMA_VERSION,
      modelVersion: REPORT_BUILDER_VERSION,
      calibrationVersion: "none/v0",
      producedAt: input.producedAt,
      metricsVersion: input.catalog.metricsVersion,
      referenceFileVersion: input.referenceSet.version,
    },
  };
}

export interface ClipForSelection {
  id: string;
  stepId: string;
  status: string;
  createdAt: Date;
}

export interface ResultEvent {
  payload: unknown;
  createdAt: Date;
}

/**
 * Picks the results a report uses: per step, only the newest clip with status
 * "analyzed" counts (a re-upload supersedes the old clip once it is analysed);
 * within that clip, the newest result per (metricKey, side) wins (a retried
 * analysis appends again).
 */
export function selectResultsForReport(events: ResultEvent[], clips: ClipForSelection[]): MetricResult[] {
  const newestClipPerStep = new Map<string, ClipForSelection>();
  for (const clip of clips) {
    if (clip.status !== "analyzed") continue;
    const current = newestClipPerStep.get(clip.stepId);
    if (!current || clip.createdAt.getTime() > current.createdAt.getTime()) newestClipPerStep.set(clip.stepId, clip);
  }
  const chosenClipIds = new Set([...newestClipPerStep.values()].map((c) => c.id));

  const latest = new Map<string, { result: MetricResult; at: number }>();
  for (const event of events) {
    const result = event.payload as MetricResult;
    if (!result.clipId || !chosenClipIds.has(result.clipId)) continue;
    const key = `${result.stepId ?? ""}|${result.metricKey}|${String(result.side)}`;
    const at = event.createdAt.getTime();
    const current = latest.get(key);
    if (!current || at >= current.at) latest.set(key, { result, at });
  }
  return [...latest.values()].map((v) => v.result);
}
