import { listMetricResults } from "./events";
import { UnauthorizedError } from "./http";
import { listPatientSessions, searchPatients, type PatientRecord, type PatientSession } from "./patients";

export interface PatientHistory {
  patient: Pick<PatientRecord, "id" | "name">;
  /** All of the patient's sessions, newest first. */
  sessions: PatientSession[];
}

const MAX_PATIENTS_SCANNED = 100;

/**
 * Find the patient a session belongs to. A repeat visit gets a fresh
 * pseudonymous subject id (consent.tsx, ADR-012), so equality of
 * subjectPseudoId does not identify a patient; the patient<->subject link
 * does. There is no session->patient endpoint, so scan the patient register's
 * linked sessions. Null when no patient owns the session.
 */
export async function findPatientHistory(sessionId: string, token: string): Promise<PatientHistory | null> {
  const patients = (await searchPatients("", token)).slice(0, MAX_PATIENTS_SCANNED);
  const all = await Promise.all(
    patients.map(async (p) => ({ p, sessions: await listPatientSessions(p.id, token).catch(() => [] as PatientSession[]) }))
  );
  const hit = all.find(({ sessions }) => sessions.some((s) => s.id === sessionId));
  return hit ? { patient: { id: hit.p.id, name: hit.p.name }, sessions: hit.sessions } : null;
}

const time = (iso: string) => {
  const n = new Date(iso).getTime();
  return Number.isNaN(n) ? Number.NEGATIVE_INFINITY : n;
};

/** Sessions strictly earlier than `sessionId`, newest first. */
export function earlierSessions(sessions: PatientSession[], sessionId: string): PatientSession[] {
  const current = sessions.find((s) => s.id === sessionId);
  if (!current) return [];
  return sessions
    .filter((s) => s.id !== sessionId && time(s.createdAt) < time(current.createdAt))
    .sort((a, b) => time(b.createdAt) - time(a.createdAt));
}

/** Most recent earlier session that has at least one metric result, or null. Checks at most `cap`. */
export async function latestEarlierWithResults(
  sessions: PatientSession[], sessionId: string, token: string, cap = 5
): Promise<PatientSession | null> {
  for (const s of earlierSessions(sessions, sessionId).slice(0, cap)) {
    try {
      if ((await listMetricResults(s.id, token)).length > 0) return s;
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
    }
  }
  return null;
}
