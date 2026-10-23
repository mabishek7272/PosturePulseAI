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
      )[]
    ];
    detail?: string;
  };
  notMeasurable?: {
    reason: string;
    whatWouldBeNeeded: string;
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
     * What produced the measurement (ADR-018). Only 'mediapipe_2d_image_plane' is implemented by the automated pipeline this phase; 'clinician_manual' and 'clinician_annotated' are for a reference-study or annotated value entered by a clinician; 'entered' is any other typed-in value; 'markerless_3d' is reserved for a future multi-camera pipeline and has no implementation (docs/adr/018-measurement-method-and-validation-strategy.md).
     */
    measurementMethod?:
      "mediapipe_2d_image_plane" | "clinician_manual" | "clinician_annotated" | "entered" | "markerless_3d";
  };
} & {
  [k: string]: unknown;
};
