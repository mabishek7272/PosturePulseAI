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
 */
export function createConsentRecord(subjectPseudoId: string): Promise<{ consentRecordId: string }> {
  return request<{ consentRecordId: string }>("/consent-records", {
    method: "POST",
    body: { subjectPseudoId, scopes: ["derived_events"] },
  });
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
