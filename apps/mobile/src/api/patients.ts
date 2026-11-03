import { request } from "./http";

export type Smoking = "never" | "former" | "current";
export type Alcohol = "never" | "occasional" | "regular";
export type PhysicalActivityLevel = "sedentary" | "light" | "moderate" | "active";

/**
 * Optional clinical intake, collected alongside identity at patient creation.
 * Documentary context for the clinician only - mirrors
 * services/backend-api/src/patients/patients.service.ts PatientIntake
 * exactly. Nothing in the measurement pipeline reads this; there is no
 * stratified reference-range logic behind it yet (CLAUDE.md, no fabricated
 * clinical claims without clinical-lead sign-off).
 */
export interface PatientIntake {
  heightCm?: number;
  weightKg?: number;
  smoking?: Smoking;
  alcohol?: Alcohol;
  physicalActivityLevel?: PhysicalActivityLevel;
  physicalProblems?: string | null;
  recentAccident?: boolean;
  recentAccidentDetails?: string | null;
}

/**
 * Identifying fields are decrypted by backend-api for this response only
 * (ADR-017). They must never be written into an event, a session record or a
 * report body - the visit is identified by its pseudonymous subject id.
 */
export interface PatientRecord {
  id: string;
  name: string;
  dateOfBirth: string;
  contact?: string | null;
  intake?: PatientIntake | null;
  createdAt?: string;
}

export interface NewPatient {
  name: string;
  dateOfBirth: string;
  contact?: string;
  intake?: PatientIntake;
}

/** GET /patients; with no query the server returns the register (name order, capped at 200). */
export function searchPatients(query: string | undefined, token: string): Promise<PatientRecord[]> {
  const path = query ? `/patients?q=${encodeURIComponent(query)}` : "/patients";
  return request<PatientRecord[]>(path, { token });
}

export function createPatient(patient: NewPatient, token: string): Promise<PatientRecord> {
  return request<PatientRecord>("/patients", { method: "POST", body: patient, token });
}

/** Ties this visit's pseudonymous subject id to the patient record. */
export function linkPatient(
  patientId: string,
  subjectPseudoId: string,
  token: string
): Promise<unknown> {
  return request(`/patients/${encodeURIComponent(patientId)}/link`, {
    method: "POST",
    body: { subjectPseudoId },
    token,
  });
}

/** One session linked to a patient (GET /patients/:id/sessions, newest first). */
export interface PatientSession {
  id: string;
  state: string;
  createdAt: string;
  protocolId: string;
}

export function listPatientSessions(patientId: string, token: string): Promise<PatientSession[]> {
  return request<PatientSession[]>(`/patients/${encodeURIComponent(patientId)}/sessions`, { token });
}
