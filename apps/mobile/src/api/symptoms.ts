import { BACKEND_URL } from "./config";

/** The enum in `packages/schemas/src/symptom-report.schema.json`. */
export const SYMPTOMS = ["pain", "dizziness", "weakness", "breathlessness", "other"] as const;
export type Symptom = (typeof SYMPTOMS)[number];

export const SEVERITIES = ["mild", "moderate", "severe"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface SymptomReportResult {
  symptomReportId: string;
  /** The safety state the session moved to - `Pause`, or escalated. */
  state: string;
}

/**
 * Posts a symptom report. **Never call this before stopping the recording.**
 *
 * The local stop must complete first and must not depend on this call
 * succeeding. `docs/regulatory/usability-engineering-file.md` names the hazard
 * as "delayed or failed stop during an adverse symptom" and the control as
 * local-first; a patient who feels unwell must not be waiting on a network
 * round-trip. `reportSymptomStopped` below is the one entry point and it takes
 * the already-stopped state as a given.
 *
 * This deliberately does NOT go through `request()`. Two reasons:
 *
 * 1. `request()` routes 401 into `setUnauthorizedHandler`, which clears the
 *    stored token and bounces to the login screen. Doing that in the middle of
 *    a symptom report would throw away the session the clinician needs to see.
 *    The server never rejects this endpoint for auth anyway - it accepts the
 *    report, pauses, and only logs the auth status - so a 401 here would be a
 *    misconfiguration, not an expired session.
 * 2. It retries once. Every other call in this app fails to a visible error and
 *    the user tries again; this one has a patient standing in front of it, so a
 *    single dropped packet should not be the difference between a clinician
 *    being told and not.
 */
export async function reportSymptom(input: {
  sessionId: string;
  symptoms: Symptom[];
  severity: Severity;
  freeText?: string | null;
  /** The subject token. Optional on purpose - see above. */
  token?: string;
  /** Injected in tests. */
  retries?: number;
}): Promise<SymptomReportResult> {
  if (input.symptoms.length === 0) {
    // The schema requires at least one, and the server would 500 on an empty
    // array after having already paused. Caught here so the caller gets a clear
    // failure rather than a half-applied report.
    throw new Error("A symptom report needs at least one symptom.");
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  const body = JSON.stringify({
    sessionId: input.sessionId,
    symptoms: input.symptoms,
    severity: input.severity,
    freeText: input.freeText ?? null,
    triggeredAction: "pause",
  });

  const attempts = (input.retries ?? 1) + 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${BACKEND_URL}/symptom-reports`, {
        method: "POST",
        headers,
        body,
      });
      if (!response.ok) throw new Error(`The clinic server returned ${response.status}.`);
      return (await response.json()) as SymptomReportResult;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("The symptom report could not be sent to the clinic server.");
}
