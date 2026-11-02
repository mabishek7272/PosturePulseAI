import { DeviceMotion, DeviceMotionMeasurement } from "expo-sensors";

export type Vector3 = [number, number, number];

export interface GravitySample {
  /** Seconds since recording started. */
  t: number;
  g: Vector3;
}

/**
 * Converts a device-motion reading into the unit gravity direction in camera
 * frame C, which clip-capture.schema.json defines as x = image right,
 * y = image down, z = optical axis away from the camera.
 *
 * Device axes (portrait, back camera) are x = right, y = up, z = out of the
 * screen toward the viewer, so image-down is -y and the back-camera optical
 * axis is -z. A level phone filming upright therefore yields approximately
 * [0, 1, 0], which is the sanity check the schema itself documents - verify it
 * on a real device before trusting any measurement (Task 13).
 */
export function toCameraFrameGravity(m: DeviceMotionMeasurement): Vector3 | null {
  const withGravity = m.accelerationIncludingGravity;
  if (!withGravity) return null;
  const linear = m.acceleration ?? { x: 0, y: 0, z: 0 };
  // Removing linear acceleration leaves gravity alone, so a moving phone
  // still reports which way is down.
  const gx = withGravity.x - linear.x;
  const gy = withGravity.y - linear.y;
  const gz = withGravity.z - linear.z;
  const magnitude = Math.hypot(gx, gy, gz);
  if (magnitude < 1e-6) return null;
  return [gx / magnitude, -gy / magnitude, -gz / magnitude];
}

/**
 * Samples gravity for the duration of a recording. Returns a stop function
 * that yields the samples collected, timestamped from the moment sampling
 * began.
 */
export function startGravitySampling(intervalMs = 16): () => GravitySample[] {
  const samples: GravitySample[] = [];
  let stopped = false;
  const startedAt = Date.now();

  DeviceMotion.setUpdateInterval(intervalMs);
  const subscription = DeviceMotion.addListener((measurement) => {
    const g = toCameraFrameGravity(measurement);
    if (g) samples.push({ t: (Date.now() - startedAt) / 1000, g });
  });

  return () => {
    if (!stopped) {
      stopped = true;
      subscription.remove();
    }
    return samples;
  };
}
