/* eslint-disable */
/**
 * Generated from packages/schemas/src/metric-result.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * One assessment measurement (ADR-015). Exactly one of estimate / unsupported / notMeasurable is present: a value is never shown without its uncertainty, a quality failure is never silently dropped, and anything the system cannot measure says so instead of guessing (CLAUDE.md rule 3).
 */
export type MetricResult = {
  resultId: string;
  sessionId: string;
  /**
   * Clip the result was computed from; null for entered values and the standing not-measurable list.
   */
  clipId?: string | null;
  stepId?: string | null;
  /**
   * Stable key from the metric registry, e.g. "static.shoulder_line_tilt".
   */
  metricKey: string;
  module: "static" | "functional" | "gait" | "workstation" | "ergonomic";
  /**
   * estimate: a measurement with uncertainty, not yet clinically evidenced (see provenance.measurementMethod for how it was produced). proxy: stands in for a named clinical construct and never borrows that construct's norms. entered/annotated: supplied by a clinician. not_measurable: not obtainable with this system.
   */
  tier: "estimate" | "proxy" | "entered" | "annotated" | "not_measurable";
  unit: "deg" | "cm" | "percent_stature" | "s" | "count" | "per_min" | "percent" | "none";
  side: "left" | "right" | "bilateral" | null;
  estimate?: {
    value: number;
    /**
     * Same unit as value; combines per-frame landmark uncertainty and spread across the frames used.
     */
    uncertainty: number;
    framesUsed: number;
    /**
     * What a positive value means, e.g. "positive = right side lower".
     */
    signConvention?: string;
  };
  unsupported?: {
    /**
     * @minItems 1
     */
    reasons: [
      (
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
      ),
      ...(
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
      )[]
    ];
    detail?: string;
  };
  notMeasurable?: {
    reason: string;
    whatWouldBeNeeded: string;
  };
  /**
   * The payload of tier=annotated: a value a named clinician produced by moving one or more landmarks on a keyframe of the clip, in place of the machine's placement. Mutually exclusive with estimate, unsupported and notMeasurable.
   *
   * Annotated does NOT mean more accurate, and nothing here claims it. Moving a landmark corrects the pose model's MISPLACEMENT of it; it cannot remove the dominant static errors - landmark-to-bony-landmark offset, soft tissue and clothing - which are the same for a clinician's placement as for the model's. So `uncertainty` is still required, and it is not a measure of the clinician's confidence.
   */
  annotated?: {
    value: number;
    /**
     * Same unit as value. Computed by the same declared uncertainty model as a machine estimate, from the adjusted landmark positions - NOT entered by the annotator. A clinician's own sense of how sure they are is not a propagated uncertainty, and accepting it would let an annotation look more precise than the instrument can be.
     */
    uncertainty: number;
    /**
     * The clinician's username, taken from their verified token server-side and never from the request body. An annotation nobody is named on records only that a value changed.
     */
    annotatorId: string;
    annotatedAt: string;
    /**
     * The machine result this revises. The original stays in the event log and the annotation points back at it, so the machine's value is never lost.
     */
    sourceResultId: string;
    /**
     * The keyframe the landmarks were adjusted on, as an index into clip-capture's frames[]. One frame: an annotation is a statement about a frame, not about the whole hold.
     */
    sourceFrameIndex: number;
    /**
     * Only the landmarks that moved, not the full 33-point set. At least one: an annotation with no adjustment would be a machine result carrying a clinician's name. A clinician reviewing and agreeing is a different act and deserves its own record rather than this one.
     *
     * @minItems 1
     */
    adjustments: [
      {
        landmark: string;
        /**
         * Where the model had it, in pixels of the oriented image.
         *
         * @minItems 2
         * @maxItems 2
         */
        fromPx: [number, number];
        /**
         * Where the clinician put it.
         *
         * @minItems 2
         * @maxItems 2
         */
        toPx: [number, number];
      },
      ...{
        landmark: string;
        /**
         * Where the model had it, in pixels of the oriented image.
         *
         * @minItems 2
         * @maxItems 2
         */
        fromPx: [number, number];
        /**
         * Where the clinician put it.
         *
         * @minItems 2
         * @maxItems 2
         */
        toPx: [number, number];
      }[]
    ];
  };
  evidence?: {
    frameIndices?: number[];
    landmarkSeriesSha256?: string;
  };
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
} & {
  [k: string]: unknown;
};
