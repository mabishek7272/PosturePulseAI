/* eslint-disable */
/**
 * Generated from packages/schemas/src/pose-landmark-frame.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * Per-frame estimated body landmarks with confidence and explicit observation state. An occluded joint MUST be marked 'occluded' or 'imputed' - never presented as 'observed' (TRD 2.2/2.7).
 */
export interface PoseLandmarkFrame {
  frameId: string;
  sessionId: string;
  /**
   * Stable identity across frames within a session; a change here must be treated as a possible identity swap, not silently accepted.
   */
  personTrackId: string;
  capturedAt: string;
  /**
   * TRD 2.1 coordinate frames: I=image pixels, C=camera, W=local AR world, B=body-centered skeleton, O=workstation object frame. Never equate B with a surveyed world location without a validated scale/reprojection check.
   */
  frame: "I" | "C" | "W" | "B" | "O";
  /**
   * @minItems 1
   */
  landmarks: [
    {
      jointName: string;
      /**
       * null only permitted when observationState is 'occluded' and no temporal estimate is available.
       */
      position: [number, number, number] | null;
      confidence: number;
      covariance?: [[number, number, number], [number, number, number], [number, number, number]] | null;
      /**
       * 'imputed' = temporally smoothed/predicted, not a fresh observation. Downstream consumers must not treat imputed/occluded as ground truth.
       */
      observationState: "observed" | "imputed" | "occluded";
    },
    ...{
      jointName: string;
      /**
       * null only permitted when observationState is 'occluded' and no temporal estimate is available.
       */
      position: [number, number, number] | null;
      confidence: number;
      covariance?: [[number, number, number], [number, number, number], [number, number, number]] | null;
      /**
       * 'imputed' = temporally smoothed/predicted, not a fresh observation. Downstream consumers must not treat imputed/occluded as ground truth.
       */
      observationState: "observed" | "imputed" | "occluded";
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
