import type { PatientRecord } from "../api/patients";

/** Searches shorter than this are not sent to the server; the full list is shown instead. */
export const MIN_SEARCH_CHARS = 2;

/** The query to send, or undefined to load the clinician's whole register. */
export function effectiveQuery(raw: string): string | undefined {
  const q = raw.trim();
  return q.length >= MIN_SEARCH_CHARS ? q : undefined;
}

/** Newest first by createdAt when the API supplies it; otherwise the order returned. */
export function sortRecentFirst(patients: PatientRecord[]): PatientRecord[] {
  const stamp = (p: PatientRecord) => (p.createdAt ? Date.parse(p.createdAt) : NaN);
  return patients
    .map((p, i) => ({ p, i, t: stamp(p) }))
    .sort((a, b) => {
      if (Number.isNaN(a.t) || Number.isNaN(b.t)) return a.i - b.i;
      return b.t - a.t || a.i - b.i;
    })
    .map((x) => x.p);
}

export type PatientListView = "loading" | "error" | "list" | "empty" | "noMatches";

/** Which body the Patients screen shows. A visible list always wins over a stale error/loading flag. */
export function patientListView(opts: {
  loading: boolean;
  error: string | null;
  count: number;
  query: string;
}): PatientListView {
  if (opts.count > 0) return "list";
  if (opts.loading) return "loading";
  if (opts.error) return "error";
  return effectiveQuery(opts.query) ? "noMatches" : "empty";
}
