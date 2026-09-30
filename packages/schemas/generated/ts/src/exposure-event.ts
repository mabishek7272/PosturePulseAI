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
  };
}
