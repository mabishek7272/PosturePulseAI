/* eslint-disable */
/**
 * Generated from packages/schemas/src/exposure-event.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * Valid time spent in a defined posture bucket (TRD 2.1) - NOT an inferred tissue-load/dose estimate. validSeconds only counts frames where the corresponding QualityGateFlag.state=='supported'; unsupported time is excluded, never fabricated as bucket time. postureBucket is assigned by a v0 heuristic threshold classifier, not a validated ergonomic exposure model (docs/claims-and-scope.md).
 */
export interface ExposureEvent {
  exposureEventId: string;
  sessionId: string;
  postureBucket:
    | "neutral"
    | "forward_flexion_mild"
    | "forward_flexion_moderate"
    | "forward_flexion_severe"
    | "lateral_lean"
    | "extension"
    | "unclassified";
  windowStartAt: string;
  windowEndAt: string;
  validSeconds: number;
  totalWindowSeconds: number;
  /**
   * @minItems 1
   */
  evidence: [
    {
      type: "calibrated-joint-frame" | "quality-gate-flag";
      refId: string;
    },
    ...{
      type: "calibrated-joint-frame" | "quality-gate-flag";
      refId: string;
    }[]
  ];
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
     * What produced the measurement (ADR-018). Only 'mediapipe_2d_image_plane' is implemented by the automated pipeline this phase; 'clinician_manual' and 'clinician_annotated' are for a reference-study or annotated value entered by a clinician; 'entered' is any other typed-in value; 'markerless_3d' is reserved for a future multi-camera pipeline and has no implementation (docs/adr/018-measurement-method-and-validation-strategy.md).
     */
    measurementMethod?:
      "mediapipe_2d_image_plane" | "clinician_manual" | "clinician_annotated" | "entered" | "markerless_3d";
  };
}
