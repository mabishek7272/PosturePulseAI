import { NativeModule, registerWebModule } from "expo";

/**
 * Web has no ARKit. This stub reports `isSupported: false` so a caller can fall
 * back, rather than throwing on import.
 */
class ARJigModule extends NativeModule<Record<never, never>> {
  readonly isSupported = false;
  readonly hasLiDAR = false;
  readonly serverMaxPitchDegrees = 12;
}

export default registerWebModule(ARJigModule, "ARJigModule");
