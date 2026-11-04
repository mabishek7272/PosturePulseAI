import { NativeModule, requireNativeModule } from "expo";

declare class ARJigModule extends NativeModule<Record<never, never>> {
  /** The device can run ARKit world tracking at all. */
  readonly isSupported: boolean;
  /**
   * The device has a LiDAR scene-reconstruction sensor. Without it the jig still
   * runs, but floor detection falls back to feature points, which can stall on
   * the glossy, textureless floors clinics tend to have.
   */
  readonly hasLiDAR: boolean;
  /**
   * The hard server-side limit the gate must stay inside, in degrees. Currently
   * **12**: `clip_quality.py` rejects a clip whose median hold pitch exceeds
   * `2 x levelToleranceDegrees`, and `levelToleranceDegrees` is 6 for every step
   * in the v0 battery. The doubling is easy to miss when reading this, so the
   * resulting number is stated outright: it is 12, not 6.
   */
  readonly serverMaxPitchDegrees: number;
}

export default requireNativeModule<ARJigModule>("ARJig");
