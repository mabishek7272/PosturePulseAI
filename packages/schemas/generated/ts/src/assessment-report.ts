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
    /**
     * Which battery step this row's result came from, so the UI can group/disambiguate left and right rows of the same metric across different steps.
     */
    stepId?: string | null;
    /**
     * What a positive value means for this row, e.g. "positive = right side lower" (metric-result.schema.json carries the same field).
     */
    signConvention?: string;
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
      | "depth_unavailable"
      | "insufficient_depth_samples"
      | "depth_landmark_disagreement"
      | "torso_plane_underdetermined"
    )[];
    reference?: {
      kind: "geometric" | "literature";
      /**
       * e.g. "0 deg" or "0-5 deg".
       */
      label: string;
      sourceCitation: string;
      status: "draft" | "approved";
      /**
       * A single-value reference's numeric value (e.g. 0 for a 0 deg geometric reference). Absent for a range reference.
       */
      value?: number;
      /**
       * A range reference's lower bound. Absent for a single-value reference.
       */
      min?: number;
      /**
       * A range reference's upper bound. Absent for a single-value reference.
       */
      max?: number;
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
    /**
     * What produced the measurement (ADR-018). Only 'mediapipe_2d_image_plane' is implemented by the automated pipeline this phase; 'clinician_manual' and 'clinician_annotated' are for a reference-study or annotated value entered by a clinician; 'entered' is any other typed-in value; 'markerless_3d' is reserved for a future multi-camera pipeline and has no implementation (docs/adr/018-measurement-method-and-validation-strategy.md); 'mediapipe_2_5d_depth' is the single-view LiDAR path (ADR-020) - MediaPipe landmarks in the image plane, depth from the device's depth sensor - kept distinct from 'markerless_3d' because pooling single-view LiDAR with triangulated multi-camera data would corrupt the agreement statistics in app/analysis/agreement.py, and deliberately ONE value for the whole depth path rather than one per metric, so those strata stay large enough to mean anything.
     */
    method?:
      | "mediapipe_2d_image_plane"
      | "clinician_manual"
      | "clinician_annotated"
      | "entered"
      | "markerless_3d"
      | "mediapipe_2_5d_depth";
    /**
     * Present only on tier=annotated rows: who placed the landmarks, when, and which machine result they revise, so a reader can see the value is a clinician's placement rather than the machine's (CLAUDE.md rule 4). Optional so released reports signed before this field existed remain valid with no migration.
     */
    annotation?: {
      annotatorId: string;
      annotatedAt: string;
      sourceResultId: string;
      adjustmentCount: number;
    };
    /**
     * Narrow provenance of the measurement itself, distinct from the report's own build-time provenance (the report-level provenance.modelVersion identifies the report builder, not what measured the body).
     */
    measuredBy?: {
      modelVersion: string;
      adapterVersion?: string;
      metricsVersion?: string;
    };
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
    /**
     * What produced the measurement (ADR-018). Only 'mediapipe_2d_image_plane' is implemented by the automated pipeline this phase; 'clinician_manual' and 'clinician_annotated' are for a reference-study or annotated value entered by a clinician; 'entered' is any other typed-in value; 'markerless_3d' is reserved for a future multi-camera pipeline and has no implementation (docs/adr/018-measurement-method-and-validation-strategy.md); 'mediapipe_2_5d_depth' is the single-view LiDAR path (ADR-020) - MediaPipe landmarks in the image plane, depth from the device's depth sensor - kept distinct from 'markerless_3d' because pooling single-view LiDAR with triangulated multi-camera data would corrupt the agreement statistics in app/analysis/agreement.py, and deliberately ONE value for the whole depth path rather than one per metric, so those strata stay large enough to mean anything.
     */
    measurementMethod?:
      | "mediapipe_2d_image_plane"
      | "clinician_manual"
      | "clinician_annotated"
      | "entered"
      | "markerless_3d"
      | "mediapipe_2_5d_depth";
  };
}
