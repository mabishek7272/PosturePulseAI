/* eslint-disable */
/**
 * Generated from packages/schemas/src/clip-capture.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * Sidecar uploaded with every assessment clip (ADR-013). Lets the server analyse the clip against true vertical and real frame timing instead of the phone's edges and arrival time. Contains no identifiers beyond the pseudonymous session.
 */
export interface ClipCapture {
  clipId: string;
  sessionId: string;
  /**
   * Step id from the assessment battery, e.g. "static.anterior".
   */
  stepId: string;
  /**
   * Which side of the body faces the camera. left_lateral = the person's left side faces the camera.
   */
  view: "anterior" | "posterior" | "left_lateral" | "right_lateral";
  recordedAt: string;
  nominalFps: number;
  /**
   * Encoded frame width in pixels, after applying the clip's orientation.
   */
  width: number;
  height: number;
  /**
   * One entry per encoded frame, in order.
   *
   * @minItems 1
   */
  frames: [
    {
      index: number;
      /**
       * Seconds since the clip's first frame (presentation timestamp).
       */
      t: number;
      /**
       * Unit gravity direction in the camera frame C of the oriented image: x = image right, y = image down, z = optical axis away from the camera. A level phone filming upright yields approximately [0, 1, 0].
       *
       * @minItems 3
       * @maxItems 3
       */
      gravity: [number, number, number];
    },
    ...{
      index: number;
      /**
       * Seconds since the clip's first frame (presentation timestamp).
       */
      t: number;
      /**
       * Unit gravity direction in the camera frame C of the oriented image: x = image right, y = image down, z = optical axis away from the camera. A level phone filming upright yields approximately [0, 1, 0].
       *
       * @minItems 3
       * @maxItems 3
       */
      gravity: [number, number, number];
    }[]
  ];
  /**
   * Pinhole intrinsics in pixels for the oriented image, when the device reports them.
   */
  intrinsics?: {
    fx: number;
    fy: number;
    cx: number;
    cy: number;
  } | null;
  device: {
    /**
     * Hardware identifier, e.g. "iPad16,2".
     */
    model: string;
    lens: "back_wide" | "back_ultrawide" | "front";
    appVersion: string;
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
  };
}
