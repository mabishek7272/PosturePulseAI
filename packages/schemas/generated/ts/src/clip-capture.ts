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
      /**
       * Which sub-phase of the step this frame fell in, when the step declares `subBlocks` (assessment-battery.schema.json). Absent for an ordinary single-phase hold.
       *
       * Recorded per frame, at capture time, by the only party that knows: the device driving the cadence. The alternative - having the analysis infer boundaries from declared durations - would be a guess that drifts with every dropped frame and every pause, and a frame attributed to the wrong phase is a measurement of the wrong thing rather than a missing one.
       */
      subPhase?: "relaxed" | "habitual" | "standardized";
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
      /**
       * Which sub-phase of the step this frame fell in, when the step declares `subBlocks` (assessment-battery.schema.json). Absent for an ordinary single-phase hold.
       *
       * Recorded per frame, at capture time, by the only party that knows: the device driving the cadence. The alternative - having the analysis infer boundaries from declared durations - would be a guess that drifts with every dropped frame and every pause, and a frame attributed to the wrong phase is a measurement of the wrong thing rather than a missing one.
       */
      subPhase?: "relaxed" | "habitual" | "standardized";
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
  /**
   * Optional LiDAR depth track uploaded alongside the clip (ADR-020). Absent or null means the device captured no depth; it is never synthesised. The depth frames are a separate, sparser time series from the encoded video frames - they are NOT index-aligned with "frames" above, and each carries its own timestamp on the same clock.
   */
  depth?: {
    /**
     * Depth map width in pixels (256 on current iPad Pro hardware), after applying the clip's orientation. Lower than the video's width; see geometry/intrinsics.py for the rescaling convention.
     */
    width: number;
    height: number;
    /**
     * Per-frame payload format. uint16_millimetres_deflate: row-major little-endian uint16 planar depth in millimetres along the optical axis (NOT range along the ray), 0 meaning no return, compressed per frame as RAW DEFLATE (RFC 1951) with no zlib header or Adler-32 trailer. Raw rather than zlib-wrapped because that is what Apple's Compression framework emits for COMPRESSION_ZLIB, and a name that implied a wrapper that is not there would send a reader looking for the wrong first two bytes. Enumerated rather than free text so an unknown encoding is rejected at the boundary instead of being read as millimetres.
     */
    encoding: "uint16_millimetres_deflate";
    /**
     * Millimetres per stored unit. 1 for the encoding above. Carried explicitly so a future fixed-point scale does not silently reinterpret existing files.
     */
    scaleMillimetres: number;
    /**
     * Intended depth capture rate, typically 15. Informational only; "frames" carries the authoritative timing.
     */
    nominalFps?: number;
    /**
     * Number of depth frames in the file. Must equal the length of "frames"; the server rejects a mismatch rather than trusting either.
     */
    frameCount: number;
    /**
     * SHA-256 of the uploaded depth file, so a truncated or swapped track is detected before any geometry is computed.
     */
    sha256: string;
    /**
     * True when each frame carries ARKit's confidenceMap (uint8 per pixel, 0-2) appended after the depth plane. Apple documents depth accuracy as highly dependent on this value, so a false here means the per-sample confidence gate cannot run and depth sampling falls back to its statistical gates alone.
     */
    hasConfidence: boolean;
    /**
     * One entry per depth frame present, in order. A dropped depth frame is simply absent - gaps in t are expected and must not be interpolated.
     */
    frames: {
      /**
       * Position of this frame in the depth file, from 0. Not a video frame index.
       */
      index: number;
      /**
       * Seconds since the clip's FIRST VIDEO frame, on the same clock as frames[].t, so a depth frame can be paired with the nearest pose observation.
       */
      t: number;
    }[];
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
