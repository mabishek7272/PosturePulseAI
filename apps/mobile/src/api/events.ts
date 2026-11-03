import { request } from "./http";

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

export async function countMetricResults(sessionId: string, token: string): Promise<number> {
  return (await listMetricResults(sessionId, token)).length;
}
