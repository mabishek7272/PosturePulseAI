/* eslint-disable */
/**
 * Generated from packages/schemas/src/scale-calibration-record.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * Records which of the TRD 2.1 four approved scale-validation methods (if any) was applied, and the resulting scale factor. calibrated-joint-frame.calibrationRef points here; scaleValidated=true is only permitted when a record here exists for the session. Only 'subject_specific' is actually implemented this phase - the other three enum values exist so the schema doesn't need another change when they're built later (docs/adr/008-scale-calibration-scope.md).
 */
export interface ScaleCalibrationRecord {
  scaleCalibrationId: string;
  sessionId: string;
  method: "subject_specific" | "known_size_reference" | "calibrated_depth" | "stereo_multiview";
  validatedAt: string;
  /**
   * Populated only when method=subject_specific.
   */
  subjectHeightMeters?: number | null;
  /**
   * The PoseLandmarkFrame used to derive the scale factor.
   */
  referenceSourceFrameId: string;
  scaleFactorMetersPerUnit: number;
  uncertaintyMetersPerUnit: number;
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
  };
}
