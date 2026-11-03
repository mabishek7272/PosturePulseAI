import { DeviceMotion } from "expo-sensors";
import { useEffect, useState } from "react";
import { toCameraFrameGravity, type Vector3 } from "./gravity";

/** Below this in-plane gravity the phone is flat and "roll" is undefined. */
const MIN_IN_PLANE = 0.35;

/**
 * Roll of the device from vertical, in degrees, from camera-frame gravity
 * (x = image right, y = image down; see gravity.ts). 0 when upright and
 * level. Null when the device is too flat for roll to mean anything.
 */
export function rollDegrees(g: Vector3): number | null {
  if (Math.hypot(g[0], g[1]) < MIN_IN_PLANE) return null;
  return (Math.atan2(g[0], g[1]) * 180) / Math.PI;
}

/** "0.8°" style readout; a dash when there is no valid reading. */
export function formatLevel(deg: number | null): string {
  if (deg === null || !Number.isFinite(deg)) return "–°";
  const a = Math.abs(deg);
  // Avoid "-0.0": values that round to zero read as 0.0.
  return `${(a < 0.05 ? 0 : a).toFixed(1)}°`;
}

/**
 * Live level readout at ~10 Hz. It never calls setUpdateInterval: the
 * recording's gravity sampler owns the sensor rate, and this only throttles
 * what it renders. Read-only, so it cannot disturb the recorded samples.
 */
export function useDeviceLevel(): number | null {
  const [deg, setDeg] = useState<number | null>(null);
  useEffect(() => {
    let last = 0;
    const sub = DeviceMotion.addListener((m) => {
      const now = Date.now();
      if (now - last < 100) return;
      last = now;
      const g = toCameraFrameGravity(m);
      setDeg(g ? rollDegrees(g) : null);
    });
    return () => sub.remove();
  }, []);
  return deg;
}
