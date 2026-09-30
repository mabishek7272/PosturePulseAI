/* eslint-disable */
/**
 * Generated from packages/schemas/src/adverse-event-record.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * Clinician-authored, regulatory-grade adverse event documentation for a supervised clinical pilot (docs/phase4/safety-monitoring-plan.md; ADR-011). Distinct from symptom-report.schema.json: SymptomReport is the real-time, subject-entered signal that immediately pauses a session regardless of ML confidence (TRD 2.5) - it exists whether or not a study is running. AdverseEventRecord is the clinician's structured, after-the-fact clinical-trial documentation of an event (causality, seriousness, outcome, reporting timeline), which may or may not trace back to a SymptomReport, and only exists in a study context. Never auto-generated - always authored by a clinician.
 */
export interface AdverseEventRecord {
  adverseEventRecordId: string;
  /**
   * The session during which the event occurred or was noticed, if any - some AEs are reported at a later clinical follow-up not tied to a specific session.
   */
  sessionId?: string | null;
  /**
   * Same pseudonymous identifier convention as session.schema.json/consent-record.schema.json - never a direct identifier.
   */
  subjectPseudoId: string;
  /**
   * The clinician documenting this event - distinct from the subject who experienced it.
   */
  reportedByClinicianId: string;
  /**
   * The real-time symptom-report.schema.json record that triggered this, if the event was first surfaced that way. Null when the clinician identified the event independently (e.g. at a follow-up visit).
   */
  relatedSymptomReportId?: string | null;
  onsetAt: string;
  reportedAt: string;
  /**
   * Free-text clinical description of the event - never auto-generated from ML output.
   */
  description: string;
  severity: "mild" | "moderate" | "severe";
  /**
   * ICH-standard seriousness flag (results in death, is life-threatening, requires hospitalization, causes persistent/significant disability, or is another important medical event) - distinct from severity. A 'serious' event drives the reportedToEthicsBoardAt timeline, not just severity.
   */
  serious: boolean;
  /**
   * Clinician's assessment of the event's relationship to the study protocol/intervention - never inferred from system output.
   */
  causality: "unrelated" | "unlikely" | "possible" | "probable" | "definite";
  outcome: "resolved" | "resolving" | "not_resolved" | "resolved_with_sequelae" | "fatal" | "unknown";
  actionTaken:
    "none" | "session_paused" | "session_stopped" | "subject_withdrawn" | "medical_treatment_provided" | "other";
  followUpRequired?: boolean;
  /**
   * When this event was actually reported to the study's IRB/ethics board, if it met that threshold. Null does not mean not required - see docs/phase4/safety-monitoring-plan.md for the reporting-timeline obligation this field only records compliance with, and never enforces by itself.
   */
  reportedToEthicsBoardAt?: string | null;
}
