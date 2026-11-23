import { clearToken, getRefreshToken, getToken, setSession } from "../auth/tokenStore";
import { BACKEND_API_URL } from "./config";
import type {
  AdverseEventRecord,
  AssessmentBattery,
  AssessmentReportBody,
  AuditLogEntryRecord,
  EventRecord,
  ExposureSummary,
  NewPatient,
  PatientRecord,
  PilotMetricsSummary,
  ReportSummary,
  RowExclusion,
  SessionRecord,
} from "./types";

class UnauthorizedError extends Error {
  constructor() {
    super("Not logged in, or the session has expired - please log in again.");
  }
}

let refreshInFlight: Promise<string | null> | null = null;

/**
 * Renews the access token with the stored refresh token (which rotates). One renewal at a time,
 * so concurrent 401s share it - a second use of a spent refresh token looks like theft to the
 * server. Null means the session is over; a network failure rejects and signs nobody out.
 */
function refreshAccessToken(staleToken: string): Promise<string | null> {
  const current = getToken();
  if (current && current !== staleToken) return Promise.resolve(current);
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;
    const response = await fetch(`${BACKEND_API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(`Session refresh failed: ${response.status}`);
    const session = (await response.json()) as { accessToken: string; refreshToken: string };
    setSession(session.accessToken, session.refreshToken);
    return session.accessToken;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Sends the request; on a 401 renews the access token once and sends it again. */
async function sendWithRefresh(send: (token: string | null) => Promise<Response>): Promise<Response> {
  const token = getToken();
  const response = await send(token);
  if (response.status !== 401 || !token) return response;
  const fresh = await refreshAccessToken(token);
  return fresh ? send(fresh) : response;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await sendWithRefresh((token) =>
    fetch(`${BACKEND_API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  );

  if (response.status === 401) {
    // The token is missing/expired/invalid - clear it so AuthContext's
    // subscribers (the route guard) send the user back to /login, rather
    // than the page silently showing an error forever.
    clearToken();
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

async function serverMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body?.message === "string") return body.message;
    if (Array.isArray(body?.message)) return body.message.join("; ");
  } catch {
    // No JSON body - the status line is all there is.
  }
  return response.statusText;
}

interface PostOptions {
  /**
   * Sign-off re-verifies the clinician's password; a rejected password must
   * not log the clinician out, so that route opts out of clearing the token.
   */
  unauthorizedMessage?: string;
  /**
   * Called before unauthorizedMessage is thrown, to tell a rejected password from an
   * expired session: it should make a call that throws if the token is no longer valid.
   */
  verifySession?: () => Promise<unknown>;
}

/** Authenticated JSON POST, used by the report-review and patient-register mutations. */
async function postJson<T>(path: string, body: unknown, options: PostOptions = {}): Promise<T> {
  const response = await sendWithRefresh((token) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${BACKEND_API_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  });

  if (response.status === 401) {
    if (options.unauthorizedMessage) {
      if (options.verifySession) {
        try {
          await options.verifySession();
        } catch (err) {
          if (err instanceof UnauthorizedError) throw err; // session expired; token already cleared
          // Any other failure: cannot tell, so fall through to the password message.
        }
      }
      throw new Error(options.unauthorizedMessage);
    }
    clearToken();
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    throw new Error(`POST ${path} failed: ${response.status} ${await serverMessage(response)}`);
  }
  return (await response.json()) as T;
}

/** POST /auth/login (services/backend-api/src/auth/auth.controller.ts) - the only unauthenticated call this client makes. */
export async function login(username: string, password: string): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await fetch(`${BACKEND_API_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    throw new Error(response.status === 401 ? "Invalid username or password" : `Login failed: ${response.status}`);
  }
  return (await response.json()) as { accessToken: string; refreshToken: string };
}

/** POST /auth/logout - revokes the session server-side. Best effort: signing out never waits on or fails because of it. */
export async function logoutRequest(): Promise<void> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return;
  try {
    await fetch(`${BACKEND_API_URL}/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // Offline: the token still expires on its own and is forgotten below.
  }
}

/** GET /sessions - the review queue (services/backend-api/src/sessions/sessions.controller.ts). Clinician-only. */
export function listSessions(state?: string): Promise<SessionRecord[]> {
  const query = state ? `?state=${encodeURIComponent(state)}` : "";
  return getJson<SessionRecord[]>(`/sessions${query}`);
}

export function getSession(sessionId: string): Promise<SessionRecord> {
  return getJson<SessionRecord>(`/sessions/${sessionId}`);
}

/** GET /sessions/:id/events - the full append-only log, used for the timeline. */
export function listEvents(sessionId: string): Promise<EventRecord[]> {
  return getJson<EventRecord[]>(`/sessions/${sessionId}/events`);
}

export function getExposureSummary(sessionId: string): Promise<ExposureSummary> {
  return getJson<ExposureSummary>(`/sessions/${sessionId}/exposure/summary`);
}

/** GET /audit-log - who has looked at what (docs/adr/010-clinician-authentication.md). Clinician-only. */
export function listAuditLog(limit?: number): Promise<AuditLogEntryRecord[]> {
  const query = limit ? `?limit=${limit}` : "";
  return getJson<AuditLogEntryRecord[]>(`/audit-log${query}`);
}

/** GET /pilot-metrics - aggregate safety-monitoring metrics (docs/phase4/safety-monitoring-plan.md). Clinician-only. */
export function getPilotMetrics(): Promise<PilotMetricsSummary> {
  return getJson<PilotMetricsSummary>("/pilot-metrics");
}

/**
 * GET /adverse-events - clinical-trial adverse event documentation
 * (docs/phase4/safety-monitoring-plan.md). Clinician-only. Read-only here by
 * design (App.tsx) - creating a report stays API-only, same as every other
 * mutating action this dashboard deliberately doesn't surface.
 */
export function listAdverseEvents(seriousOnly?: boolean): Promise<AdverseEventRecord[]> {
  const query = seriousOnly ? "?seriousOnly=true" : "";
  return getJson<AdverseEventRecord[]>(`/adverse-events${query}`);
}

// --- M1 static battery (docs/superpowers/specs/2026-10-23-m1-static-battery.md, slice D) ---

/** GET /assessment-battery (public) - used only to show step titles next to step ids. */
export function getAssessmentBattery(): Promise<AssessmentBattery> {
  return getJson<AssessmentBattery>("/assessment-battery");
}

/** GET /reports?status= - clinician-only. Summaries only; use getReport for the full body. */
export function listReports(status?: "draft" | "released"): Promise<ReportSummary[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return getJson<ReportSummary[]>(`/reports${query}`);
}

export function getReport(reportId: string): Promise<AssessmentReportBody> {
  return getJson<AssessmentReportBody>(`/reports/${encodeURIComponent(reportId)}`);
}

/** POST /sessions/:id/report - builds the next draft version from the session's latest metric results. */
export function buildDraftReport(sessionId: string): Promise<AssessmentReportBody> {
  return postJson<AssessmentReportBody>(`/sessions/${encodeURIComponent(sessionId)}/report`, {});
}

export function excludeReportRow(reportId: string, exclusion: RowExclusion): Promise<AssessmentReportBody> {
  return postJson<AssessmentReportBody>(`/reports/${encodeURIComponent(reportId)}/rows/exclude`, exclusion);
}

export function saveClinicianAssessment(reportId: string, text: string): Promise<AssessmentReportBody> {
  return postJson<AssessmentReportBody>(`/reports/${encodeURIComponent(reportId)}/assessment`, { text });
}

/** POST /reports/:id/sign-off - backend-api re-verifies the password before releasing the report. */
export function signOffReport(reportId: string, password: string): Promise<AssessmentReportBody> {
  return postJson<AssessmentReportBody>(
    `/reports/${encodeURIComponent(reportId)}/sign-off`,
    { password },
    {
      unauthorizedMessage: "Sign-off not accepted: check your password and try again.",
      // A 401 can mean a wrong password or an expired token; an authenticated GET tells them apart.
      verifySession: () => getReport(reportId),
    }
  );
}

export function rejectReport(reportId: string, reason: string): Promise<AssessmentReportBody> {
  return postJson<AssessmentReportBody>(`/reports/${encodeURIComponent(reportId)}/reject`, { reason });
}

/** GET /patients?q= - backend-api decrypts and filters (ADR-017). Clinician-only, audited. */
export function searchPatients(query: string): Promise<PatientRecord[]> {
  const q = query ? `?q=${encodeURIComponent(query)}` : "";
  return getJson<PatientRecord[]>(`/patients${q}`);
}

export function createPatient(patient: NewPatient): Promise<PatientRecord> {
  return postJson<PatientRecord>("/patients", patient);
}

export function listPatientSessions(patientId: string): Promise<SessionRecord[]> {
  return getJson<SessionRecord[]>(`/patients/${encodeURIComponent(patientId)}/sessions`);
}

/** subjectPseudoId -> linked patient (id and name). Visits with no linked patient are absent. */
export type SubjectNames = Record<string, { patientId: string; name: string }>;

export function getSubjectNames(): Promise<SubjectNames> {
  return getJson<SubjectNames>("/patients/subject-names");
}

export interface ErasureResult {
  patientId: string;
  sessions: number;
  clips: number;
  reports: number;
  events: number;
  filesRemoved: number;
}

/** PERMANENT. The server also requires `confirmName` to equal the patient's name. */
export async function erasePatient(patientId: string, confirmName: string): Promise<ErasureResult> {
  const response = await sendWithRefresh((token) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${BACKEND_API_URL}/patients/${encodeURIComponent(patientId)}`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ confirmName }),
    });
  });
  if (response.status === 401) {
    clearToken();
    throw new UnauthorizedError();
  }
  if (!response.ok) throw new Error(await serverMessage(response));
  return (await response.json()) as ErasureResult;
}

