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

// ---------------------------------------------------------------------------
// M1 static battery: assessment reports and the patient register
// (docs/superpowers/specs/2026-10-23-m1-static-battery.md, slices B and D).
// ---------------------------------------------------------------------------

/** quality-gate-flag.schema.json#/$defs/reason */
export type QualityReason =
  | "insufficient_landmarks"
  | "insufficient_scale"
  | "identity_uncertain"
  | "anchor_drift"
  | "low_confidence"
  | "occlusion"
  | "wrong_view"
  | "out_of_frame"
  | "camera_not_level"
  | "insufficient_frame_rate"
  | "insufficient_frames"
  | "subject_moving";

/** metric-result.schema.json `tier` */
export type MetricTier = "estimate" | "proxy" | "entered" | "annotated" | "not_measurable";

/** assessment-report.schema.json rows[].position */
export type ReportPosition = "below" | "within" | "above" | "indeterminate" | "no_reference" | "not_applicable";

export type ReportSide = "left" | "right" | "bilateral" | null;

/** common.schema.json#/$defs/provenance */
export interface Provenance {
  schemaVersion: string;
  modelVersion: string;
  adapterVersion?: string;
  calibrationVersion: string;
  producedAt: string;
  metricsVersion?: string;
  referenceFileVersion?: string;
  clipSha256?: string;
}

/** assessment-report.schema.json rows[] */
export interface ReportRow {
  metricKey: string;
  resultId?: string | null;
  /**
   * Not in the v0 row schema (which allows extra properties): the backend
   * report builder keys rows by (metricKey, side, stepId) and the exclude
   * route needs it, so rows are expected to carry it. Rows without it are
   * grouped under "Step not recorded".
   */
  stepId?: string | null;
  label: string;
  module: "static" | "functional" | "gait" | "workstation" | "ergonomic";
  tier: MetricTier;
  unit: string;
  side: ReportSide;
  estimate?: { value: number; uncertainty: number } | null;
  unsupportedReasons?: QualityReason[];
  reference?: {
    kind: "geometric" | "literature";
    label: string;
    sourceCitation: string;
    status: "draft" | "approved";
  } | null;
  position: ReportPosition;
  analysis: { text: string; source: "fixed_template"; templateId?: string };
  excluded: { reason: string; clinicianId: string } | null;
}

export interface NotMeasurableItem {
  metricKey: string;
  label: string;
  reason: string;
  whatWouldBeNeeded: string;
}

export type ReportStatus = "draft" | "released" | "rejected";

/** assessment-report.schema.json (the report body) */
export interface AssessmentReportBody {
  reportId: string;
  sessionId: string;
  reportVersion: number;
  supersedesReportId?: string | null;
  status: ReportStatus;
  rows: ReportRow[];
  notMeasurable: NotMeasurableItem[];
  clinicianAssessment: { text: string; clinicianId: string } | null;
  signOff: { clinicianId: string; signedAt: string; contentSha256: string } | null;
  provenance: Provenance;
}

/** Prisma `AssessmentReport` model (spec slice B) as returned by GET /reports and GET /reports/:id. */
export interface AssessmentReportRecord {
  id: string;
  sessionId: string;
  reportVersion: number;
  status: ReportStatus;
  body: AssessmentReportBody;
  signedBy: string | null;
  signedAt: string | null;
  contentSha256: string | null;
  createdAt: string;
}

/** POST /reports/:id/rows/exclude body */
export interface RowExclusion {
  metricKey: string;
  side: ReportSide;
  stepId: string | null;
  reason: string;
}

/** assessment-battery.schema.json - only the fields this app reads. */
export interface AssessmentBattery {
  version: string;
  status: "draft" | "approved";
  steps: Array<{ stepId: string; title: string; view?: string; metricKeys?: string[] }>;
}

/**
 * Patient register entry (ADR-017), already decrypted by backend-api. These
 * identifiers are shown only on the register page and never written to the
 * event log, browser storage or any other record.
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
