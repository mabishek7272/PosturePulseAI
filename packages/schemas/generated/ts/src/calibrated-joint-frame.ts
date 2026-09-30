/* eslint-disable */
/**
 * Generated from packages/schemas/src/calibrated-joint-frame.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * Joint angles derived from a PoseLandmarkFrame via the TRD 2.1 formula theta = acos(((a-b).(c-b))/(||a-b|| ||c-b||)), with covariance propagation. Only produced when scale/reprojection has been checked; otherwise angles are still normalized but scaleValidated=false and no metric distance claims may be attached downstream.
 */
export interface CalibratedJointFrame {
  jointFrameId: string;
  sessionId: string;
  /**
   * ID of the PoseLandmarkFrame this was derived from.
   */
  sourceFrameId: string;
  capturedAt: string;
  /**
   * TRD 2.1 coordinate frames: I=image pixels, C=camera, W=local AR world, B=body-centered skeleton, O=workstation object frame. Never equate B with a surveyed world location without a validated scale/reprojection check.
   */
  frame: "I" | "C" | "W" | "B" | "O";
  /**
   * True only if scale was checked against calibrated depth, a known-size reference, stereo/multi-view, or an approved subject-specific calibration (TRD 2.1).
   */
  scaleValidated: boolean;
  /**
   * ID of the calibration/scale-check record used.
   */
  calibrationRef: string;
  /**
   * @minItems 1
   */
  angles: [
    {
      jointName: string;
      thetaRadians: number;
      uncertaintyRadians: number;
      /**
       * [a, b, c] landmark names used in the theta = acos(...) formula, vertex at b.
       *
       * @minItems 3
       * @maxItems 3
       */
      sourceLandmarks: [string, string, string];
    },
    ...{
      jointName: string;
      thetaRadians: number;
      uncertaintyRadians: number;
      /**
       * [a, b, c] landmark names used in the theta = acos(...) formula, vertex at b.
       *
       * @minItems 3
       * @maxItems 3
       */
      sourceLandmarks: [string, string, string];
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
