import { request } from "./http";

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
  createdAt?: string;
}

export interface NewPatient {
  name: string;
  dateOfBirth: string;
  contact?: string;
}

export function searchPatients(query: string, token: string): Promise<PatientRecord[]> {
  return request<PatientRecord[]>(`/patients?q=${encodeURIComponent(query)}`, { token });
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
