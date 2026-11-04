/* eslint-disable */
/**
 * Generated from packages/schemas/src/report-rejection.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * Bookkeeping event logged when a clinician rejects a draft report (ADR-015) - why the draft was withdrawn, not a measurement or an assessment. The clinician's reason is free text, so this record is deliberately left out of the research export.
 */
export interface ReportRejection {
  reportId: string;
  clinicianId: string;
  reason: string;
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
