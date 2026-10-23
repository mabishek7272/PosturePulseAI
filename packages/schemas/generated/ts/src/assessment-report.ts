/* eslint-disable */
/**
 * Generated from packages/schemas/src/assessment-report.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * A versioned assessment report (ADR-015). Built deterministically from metric results and a reference set; released only by a signed-in clinician. Report rows describe measurements only - the clinicianAssessment is the single place where a named clinician's own interpretation may appear.
 */
export interface AssessmentReport {
  reportId: string;
  sessionId: string;
  reportVersion: number;
  supersedesReportId?: string | null;
  status: "draft" | "released" | "rejected";
  rows: {
    metricKey: string;
    resultId?: string | null;
    /**
     * Descriptive name, never a condition name.
     */
    label: string;
    module: "static" | "functional" | "gait" | "workstation" | "ergonomic";
    tier: "estimate" | "proxy" | "entered" | "annotated" | "not_measurable";
    unit: string;
    side: "left" | "right" | "bilateral" | null;
    estimate?: {
      value: number;
      uncertainty: number;
    } | null;
    unsupportedReasons?: (
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
      | "subject_moving"
    )[];
    reference?: {
      kind: "geometric" | "literature";
      /**
       * e.g. "0 deg" or "0-5 deg".
       */
      label: string;
      sourceCitation: string;
      status: "draft" | "approved";
    } | null;
    /**
     * below/above only when the whole value +/- uncertainty interval lies outside the reference; indeterminate when the interval overlaps a bound; no_reference for proxies and rows without a reference; not_applicable when there is no estimate.
     */
    position: "below" | "within" | "above" | "indeterminate" | "no_reference" | "not_applicable";
    analysis: {
      text: string;
      source: "fixed_template";
      templateId?: string;
    };
    /**
     * Set when the reviewing clinician excludes the row; the row stays in the record.
     */
    excluded: {
      reason: string;
      clinicianId: string;
    } | null;
  }[];
  /**
   * The standing list of things this system cannot measure, always shown.
   */
  notMeasurable: {
    metricKey: string;
    label: string;
    reason: string;
    whatWouldBeNeeded: string;
  }[];
  clinicianAssessment: {
    text: string;
    clinicianId: string;
  } | null;
  signOff: {
    clinicianId: string;
    signedAt: string;
    contentSha256: string;
  } | null;
  /**
   * Per-record provenance so every event self-reports the versions that produced it (TRD traceability requirement).
   */
  provenance: {
    /**
     * Version of this record's own JSON Schema, e.g. "pose-landmark-frame/v0".
     */
    schemaVersion: string;
    /**
     * Identifier+version of the model/adapter that produced this record, e.g. "mediapipe-pose/0.10.9".
     */
    modelVersion: string;
    adapterVersion?: string;
    /**
     * Identifier of the camera calibration record in effect when this record was produced.
     */
    calibrationVersion: string;
    producedAt: string;
    /**
     * Version of the metric registry that computed the value, e.g. "metrics/v1".
     */
    metricsVersion?: string;
    /**
     * Version of the reference-range set used to classify the value.
     */
    referenceFileVersion?: string;
    /**
     * SHA-256 of the clip the value was computed from.
     */
    clipSha256?: string;
  };
}
