// Hand-kept, not generated - same rationale as apps/ios-client/Sources/Networking/DTOs
// (docs/adr/004-ios-dtos-hand-kept.md): this dashboard only reads a handful of
// fields per record, so a third codegen target isn't worth it yet. Each type
// below is commented with the canonical schema it mirrors
// (packages/schemas/src/*.schema.json) so drift is at least detectable by
// inspection.

/** services/backend-api/src/safety/safety-state-machine.ts */
export type SafetyState = "Setup" | "Observing" | "CueEligible" | "Pause" | "Unavailable" | "ClinicianReview";

/** Prisma `Session` model (services/backend-api/prisma/schema.prisma) */
export interface SessionRecord {
  id: string;
  subjectPseudoId: string;
  protocolId: string;
  protocolVersion: string;
  deploymentContext: "clinic_supervised" | "home_rehab";
  consentRecordId: string;
  calibrationRef: string | null;
  subjectHeightMeters: number | null;
  state: SafetyState;
  createdAt: string;
}

/** Append-only `Event` row (services/backend-api/prisma/schema.prisma) */
export interface EventRecord {
  id: string;
  sessionId: string;
  type: string;
  schemaId: string;
  payload: unknown;
  createdAt: string;
}

/** decision-event.schema.json */
export interface DecisionEventPayload {
  decisionEventId: string;
  sessionId: string;
  evaluatedAt: string;
  evidence: Array<{ type: string; refId: string; summary?: string }>;
  rule: { ruleId: string; ruleVersion: string; description: string };
  action: "no_action" | "cue" | "escalate_review" | "measurement_unavailable";
  cuePayload: unknown | null;
  version: string;
  expiry: string;
}

/** quality-gate-flag.schema.json */
export interface QualityGateFlagPayload {
  flagId: string;
  state: "supported" | "unsupported";
  reasons: string[];
}

/** symptom-report.schema.json */
export interface SymptomReportPayload {
  symptomReportId: string;
  sessionId: string;
  reportedAt: string;
  symptoms: string[];
  severity?: string;
  freeText?: string;
}

/** exposure-event.schema.json */
export interface ExposureEventPayload {
  exposureEventId: string;
  sessionId: string;
  postureBucket: string;
  windowStartAt: string;
  windowEndAt: string;
  validSeconds: number;
  totalWindowSeconds: number;
}

/** movement-phase-event.schema.json - descriptive only, never safety-relevant (ADR-005) */
export interface MovementPhaseEventPayload {
  movementPhaseEventId: string;
  sessionId: string;
  predictedPhase: string;
  phaseConfidence: number;
  validated: false;
}

export type ExposureSummary = Record<string, { validSeconds: number; totalWindowSeconds: number }>;

/** adverse-event-record.schema.json - see its own doc comment for why this is distinct from SymptomReport. */
export interface AdverseEventRecord {
  adverseEventRecordId: string;
  sessionId: string | null;
  subjectPseudoId: string;
  reportedByClinicianId: string;
  relatedSymptomReportId: string | null;
  onsetAt: string;
  reportedAt: string;
  description: string;
  severity: "mild" | "moderate" | "severe";
  serious: boolean;
  causality: "unrelated" | "unlikely" | "possible" | "probable" | "definite";
  outcome: "resolved" | "resolving" | "not_resolved" | "resolved_with_sequelae" | "fatal" | "unknown";
  actionTaken: string;
  followUpRequired: boolean;
  reportedToEthicsBoardAt: string | null;
}

/** Prisma `AuditLogEntry` model (docs/adr/010-clinician-authentication.md's named follow-up). */
export interface AuditLogEntryRecord {
  id: string;
  clinicianId: string;
  clinicianUsername: string;
  action: string;
  sessionId: string | null;
  occurredAt: string;
}

/**
 * services/backend-api/src/pilot-metrics/pilot-metrics.service.ts - a rate is
 * `null`, never 0, when its denominator is 0 (no data yet is not the same as
 * a measured zero rate). docs/phase4/safety-monitoring-plan.md.
 */
export interface PilotMetricsSummary {
  totalSessions: number;
  sessionsByState: Record<string, number>;
  qualityGate: { totalFlags: number; unsupportedCount: number; unsupportedRate: number | null };
  decisions: {
    totalDecisions: number;
    byAction: Record<string, number>;
    cueRate: number | null;
    escalateReviewRate: number | null;
  };
  symptomReports: { totalSymptomReports: number; ratePerSession: number | null };
  adverseEvents: { totalAdverseEvents: number; seriousAdverseEvents: number; ratePerSession: number | null };
}
