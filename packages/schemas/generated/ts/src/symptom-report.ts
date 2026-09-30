/* eslint-disable */
/**
 * Generated from packages/schemas/src/symptom-report.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * User-entered symptom report. Always accepted regardless of concurrent ML confidence; triggers an immediate safety-FSM transition to Pause or ClinicianReview escalation, following clinician-authored instructions (TRD 2.5).
 */
export interface SymptomReport {
  symptomReportId: string;
  sessionId: string;
  reportedAt: string;
  /**
   * @minItems 1
   */
  symptoms: [
    "pain" | "dizziness" | "weakness" | "breathlessness" | "other",
    ...("pain" | "dizziness" | "weakness" | "breathlessness" | "other")[]
  ];
  severity: "mild" | "moderate" | "severe";
  freeText?: string | null;
  triggeredAction: "pause" | "escalate_review";
}
