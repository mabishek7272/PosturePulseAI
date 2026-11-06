import { ApiError, request } from "./http";

/**
 * One measurement as the pipeline emitted it. Exactly one of `estimate`,
 * `unsupported` or `notMeasurable` is present - a measurement that could not be
 * taken says so and says why, and is never silently omitted (CLAUDE.md rule 3).
 */
export interface MetricResult {
  metricKey: string;
  stepId?: string;
  side?: string | null;
  unit?: string;
  tier?: string;
  estimate?: { value: number; uncertainty: number } | null;
  unsupported?: { reasons: string[] } | null;
  notMeasurable?: { reason: string } | null;
  /**
   * Reference comparison, present only when the server includes it (the report
   * rows carry it; the raw metric-result events do not today). Absent means
   * "no reference known" - the screen never invents one.
   */
  position?: "below" | "within" | "above" | "indeterminate" | "no_reference" | "not_applicable" | null;
  reference?: { label: string; value?: number; min?: number; max?: number } | null;
  /** Catalog label, present on report rows. */
  label?: string;
  /** The report builder's fixed-template sentence for this row. */
  analysis?: { text: string } | null;
}

/** One row of GET /sessions/:id/report-preview (the backend's ReportRow, fields the app reads). */
export interface ReportRow {
  stepId: string | null;
  metricKey: string;
  label: string;
  tier: string;
  unit: string;
  side: string | null;
  estimate: { value: number; uncertainty: number } | null;
  unsupportedReasons?: string[];
  reference: { label: string; value?: number; min?: number; max?: number } | null;
  position: NonNullable<MetricResult["position"]>;
  analysis: { text: string };
}

export function rowToResult(row: ReportRow): MetricResult {
  const unsupported = !row.estimate && row.unsupportedReasons?.length ? { reasons: row.unsupportedReasons } : null;
  // A row with neither an estimate nor reasons is a not-measurable row; the builder's sentence says why.
  const notMeasurable = !row.estimate && !unsupported ? { reason: row.analysis.text } : null;
  return {
    metricKey: row.metricKey,
    stepId: row.stepId ?? undefined,
    side: row.side,
    unit: row.unit,
    tier: row.tier,
    label: row.label,
    estimate: row.estimate,
    unsupported,
    notMeasurable,
    position: row.position,
    reference: row.reference,
    analysis: row.analysis,
  };
}

interface EventRecord {
  type: string;
  payload: unknown;
}

/** GET /sessions/:id/events is clinician-only, so this takes the clinician JWT. */
export async function listMetricResults(sessionId: string, token: string): Promise<MetricResult[]> {
  const events = await request<EventRecord[]>(
    `/sessions/${encodeURIComponent(sessionId)}/events`,
    { token }
  );
  return events.filter((e) => e.type === "metric-result").map((e) => e.payload as MetricResult);
}

/** Latest result per (metricKey, side, stepId): a re-recorded step replaces the earlier one. */
export function latestPerMetric(results: MetricResult[]): MetricResult[] {
  const byKey = new Map<string, MetricResult>();
  for (const r of results) byKey.set(`${r.metricKey}|${r.side ?? ""}|${r.stepId ?? ""}`, r);
  return [...byKey.values()];
}

/**
 * What the results screen shows: the report builder's rows (value, reference,
 * position, plain wording) from the read-only preview, which stores nothing.
 * Falls back to the raw results - with no reference comparison, which the
 * screen then states once - only when the report cannot be built right now
 * (409: nothing analysed yet; 503: metric catalog unavailable).
 */
export async function listReportResults(sessionId: string, token: string): Promise<MetricResult[]> {
  try {
    const body = await request<{ rows: ReportRow[] }>(
      `/sessions/${encodeURIComponent(sessionId)}/report-preview`,
      { token }
    );
    return body.rows.map(rowToResult);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 409 || err.status === 503)) {
      return latestPerMetric(await listMetricResults(sessionId, token));
    }
    throw err;
  }
}

export async function countMetricResults(sessionId: string, token: string): Promise<number> {
  return (await listMetricResults(sessionId, token)).length;
}
