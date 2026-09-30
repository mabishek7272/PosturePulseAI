/* eslint-disable */
/**
 * Generated from packages/schemas/src/camera-intrinsics.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * Camera intrinsics K, distortion, resolution, and orientation stored per session/segment (TRD 2.1).
 */
export interface CameraIntrinsics {
  intrinsicsId: string;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  /**
   * Distortion coefficients; order/meaning depends on distortionModel.
   */
  distortion: number[];
  distortionModel: "brown-conrady" | "fisheye" | "none";
  resolution: {
    width: number;
    height: number;
  };
  mirrorFlag: boolean;
  orientationDegrees: 0 | 90 | 180 | 270;
  capturedAt: string;
}
