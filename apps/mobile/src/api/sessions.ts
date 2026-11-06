import { request } from "./http";

export interface AssessmentBattery {
  version: string;
  status: string;
  steps: Array<{ stepId: string; title: string; view?: string }>;
}

export interface SessionCredentials {
  session: { id: string; state: string };
  /** Subject token - the ONLY token clip upload accepts. Never persisted. */
  sessionToken: string;
}

export function getAssessmentBattery(): Promise<AssessmentBattery> {
  return request<AssessmentBattery>("/assessment-battery");
}

/**
 * `derived_events` is mandatory: SessionsService refuses to create a session
 * without it. `raw_video` is deliberately not requested - P1 does not opt into
 * raw video retention, and asking for a scope we do not use would be wrong.
 *
 * POST /consent-records responds with the raw Prisma row, keyed by `id` -
 * ConsentService.create() builds a `consentRecordId`-keyed object only to
 * validate against consent-record.schema.json, then discards it and returns
 * `this.get(id)` instead. Confirmed against apps/ios-client's ConsentView,
 * which reads `record.id`. Typing this as `{ consentRecordId }` made every
 * value `undefined`, which Prisma's findUnique in ConsentService.findActive
 * then rejected server-side with "needs at least one of `id` arguments".
 */
export function createConsentRecord(subjectPseudoId: string): Promise<{ id: string }> {
  return request<{ id: string }>("/consent-records", {
    method: "POST",
    body: { subjectPseudoId, scopes: ["derived_events"] },
  });
}

/**
 * Attaches the patient's and the signed-in clinician's signatures to a consent
 * record (clinician JWT; the server takes the clinician id from the token).
 * Write-once on the server: a 409 means this record is already signed.
 */
export function signConsentRecord(
  consentRecordId: string,
  signatures: { subjectSvgPath: string; clinicianSvgPath: string },
  token: string,
): Promise<{ consentRecordId: string; signedAt: string }> {
  return request(`/consent-records/${encodeURIComponent(consentRecordId)}/signatures`, {
    method: "POST",
    body: signatures,
    token,
  });
}

/** Both signatures, for the report PDF (clinician JWT). */
export function getConsentSignatures(
  consentRecordId: string,
  token: string,
): Promise<{ subject: { svgPath: string; signedAt: string }; clinician: { svgPath: string; signedAt: string; clinicianId: string } }> {
  return request(`/consent-records/${encodeURIComponent(consentRecordId)}/signatures`, { token });
}

export function createSession(input: {
  subjectPseudoId: string;
  consentRecordId: string;
  protocolVersion: string;
}): Promise<SessionCredentials> {
  return request<SessionCredentials>("/sessions", {
    method: "POST",
    body: {
      subjectPseudoId: input.subjectPseudoId,
      protocolId: "assessment-battery",
      protocolVersion: input.protocolVersion,
      deploymentContext: "clinic_supervised",
      consentRecordId: input.consentRecordId,
      retentionPolicy: {
        rawVideo: { optIn: false, retentionDays: null },
        derivedEvents: { retentionDays: 30 },
      },
    },
  });
}
