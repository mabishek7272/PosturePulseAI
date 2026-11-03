import { DeviceMotion } from "expo-sensors";
import { useEffect, useRef, useState } from "react";
import { PITCH_TOLERANCE_DEG, ROLL_TOLERANCE_DEG } from "./guidance";
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

/**
 * Forward/back tilt of the device from upright, in degrees: asin(|g_z| / |g|)
 * of the camera-frame gravity vector (z = optical axis). This is the SAME
 * formula the server uses for its camera_not_level rejection
 * (ml-service roll_correction / clip_quality). 0 when the camera looks
 * horizontally; null when gravity is not a valid vector.
 */
export function pitchDegrees(g: Vector3): number | null {
  if (!g || g.length !== 3 || !g.every(Number.isFinite)) return null;
  const mag = Math.hypot(g[0], g[1], g[2]);
  if (mag < 1e-6) return null;
  return (Math.asin(Math.min(1, Math.abs(g[2]) / mag)) * 180) / Math.PI;
}

/** "0.8°" style readout; a dash when there is no valid reading. */
export function formatLevel(deg: number | null): string {
  if (deg === null || !Number.isFinite(deg)) return "–°";
  const a = Math.abs(deg);
  // Avoid "-0.0": values that round to zero read as 0.0.
  return `${(a < 0.05 ? 0 : a).toFixed(1)}°`;
}

/**
 * SIGNED forward/back tilt (the Y axis of the 2-axis level), degrees.
 *
 * Camera-frame gravity g' points DOWN (towards the ground) in camera axes with
 * z along the optical axis, away from the camera. If the camera looks up, its
 * optical axis has an upward component, so gravity has a NEGATIVE component
 * along z; hence Y = -asin(g'z / |g'|):
 *   Y > 0  camera pointing UP   (top of the device tilted back, away from the person holding it)
 *   Y < 0  camera pointing DOWN (top tilted forward)
 * |Y| equals pitchDegrees. Null for an invalid vector.
 */
export function signedPitchDegrees(g: Vector3): number | null {
  const p = pitchDegrees(g);
  if (p === null) return null;
  const mag = Math.hypot(g[0], g[1], g[2]);
  const v = (Math.asin(Math.max(-1, Math.min(1, -g[2] / mag))) * 180) / Math.PI;
  return v === 0 ? 0 : v; // no negative zero
}

/**
 * Both tilt axes from camera-frame gravity.
 *   x = left-right tilt (roll) = atan2(g'x, g'y). x > 0: gravity has an image-RIGHT
 *       component, i.e. the RIGHT edge is lower. Null when the device is flat.
 *   y = forward-back tilt (pitch), signed, see signedPitchDegrees.
 */
export function tiltAxes(g: Vector3 | null): { x: number | null; y: number | null } {
  if (!g) return { x: null, y: null };
  return { x: rollDegrees(g), y: signedPitchDegrees(g) };
}

/** Readings smaller than this count as neutral in the direction words. */
export const DIRECTION_DEADBAND_DEG = 0.3;

/** Plain direction words, from the point of view of the person holding the device; null = neutral / unknown. */
export function directionWordX(x: number | null): string | null {
  if (x === null || Math.abs(x) < DIRECTION_DEADBAND_DEG) return null;
  return x > 0 ? "Right side low" : "Left side low";
}
export function directionWordY(y: number | null): string | null {
  if (y === null || Math.abs(y) < DIRECTION_DEADBAND_DEG) return null;
  return y > 0 ? "Top tilted back" : "Top tilted forward";
}

/** "+0.4°" / "−1.2°" (true minus sign); 0.0° has no sign; a dash without a reading. Rounded to 0.1°. */
export function formatSigned(deg: number | null): string {
  if (deg === null || !Number.isFinite(deg)) return "–°";
  const r = Math.round(deg * 10) / 10;
  if (r === 0) return "0.0°";
  return `${r > 0 ? "+" : "\u2212"}${Math.abs(r).toFixed(1)}°`;
}

/** Round to the 0.1 degree display resolution. */
export function roundTenth(deg: number | null): number | null {
  return deg === null ? null : Math.round(deg * 10) / 10 || 0;
}

/** Smoothing time constant of the exponential moving average, ms. */
export const EMA_TAU_MS = 150;
/** React re-render rate for the tilt readout, ms between renders (~15 Hz). */
export const RENDER_INTERVAL_MS = 66;
/** The level state is left only once an axis exceeds tolerance by this much, degrees. */
export const LEVEL_HYSTERESIS_DEG = 0.3;

/**
 * One exponential-moving-average step with alpha from the real elapsed time:
 * alpha = 1 - exp(-dt / tau). No previous value (or a gap longer than 1 s)
 * restarts from the sample; a null sample clears the filter.
 */
export function emaStep(prev: number | null, sample: number | null, dtMs: number, tauMs = EMA_TAU_MS): number | null {
  if (sample === null || !Number.isFinite(sample)) return null;
  if (prev === null || !(dtMs > 0) || dtMs > 1000) return sample;
  const alpha = 1 - Math.exp(-dtMs / tauMs);
  return prev + alpha * (sample - prev);
}

/**
 * Level state with hysteresis: enter when |x| <= tolX and |y| <= tolY, leave
 * only when |x| > tolX + margin or |y| > tolY + margin. Unknown is never level.
 */
export function levelWithHysteresis(
  wasLevel: boolean, x: number | null, y: number | null,
  tolX = ROLL_TOLERANCE_DEG, tolY = PITCH_TOLERANCE_DEG, margin = LEVEL_HYSTERESIS_DEG,
): boolean {
  if (x === null || y === null) return false;
  if (wasLevel) return Math.abs(x) <= tolX + margin && Math.abs(y) <= tolY + margin;
  return Math.abs(x) <= tolX && Math.abs(y) <= tolY;
}

export interface DeviceTilt {
  /** Smoothed left-right tilt, signed degrees at 0.1 resolution (null when flat / no sensor). */
  x: number | null;
  /** Smoothed forward-back tilt, signed degrees at 0.1 resolution (null when no sensor). */
  y: number | null;
  /** Level state with hysteresis (false when unknown). */
  level: boolean;
}

/** Latest smoothed values, updated on EVERY motion sample (not throttled), for guidance and feedback. */
export interface TiltRefs {
  /** Signed left-right tilt (roll). */
  roll: { current: number | null };
  /** UNSIGNED forward-back tilt = |y|, same as the server formula. */
  pitch: { current: number | null };
}

/**
 * Live 2-axis tilt. Every DeviceMotion sample is smoothed with an EMA (tau 150 ms,
 * alpha from the real dt); React state is published at ~15 Hz at 0.1 degree
 * resolution. It never calls setUpdateInterval: the recording's gravity sampler
 * owns the sensor rate, so this hook is read-only.
 */
export function useDeviceTilt(): DeviceTilt & { refs: TiltRefs } {
  const [tilt, setTilt] = useState<DeviceTilt>({ x: null, y: null, level: false });
  const roll = useRef<number | null>(null);
  const pitch = useRef<number | null>(null);
  const refs = useRef<TiltRefs>({ roll, pitch }).current;
  useEffect(() => {
    let sx: number | null = null;
    let sy: number | null = null;
    let lastT = 0;
    let lastRender = 0;
    let level = false;
    const sub = DeviceMotion.addListener((m) => {
      const now = Date.now();
      const dt = lastT === 0 ? 0 : now - lastT;
      lastT = now;
      const raw = tiltAxes(toCameraFrameGravity(m));
      sx = emaStep(sx, raw.x, dt);
      sy = emaStep(sy, raw.y, dt);
      roll.current = sx;
      pitch.current = sy === null ? null : Math.abs(sy);
      if (now - lastRender < RENDER_INTERVAL_MS) return;
      lastRender = now;
      const x = roundTenth(sx);
      const y = roundTenth(sy);
      level = levelWithHysteresis(level, x, y);
      setTilt((p) => (p.x === x && p.y === y && p.level === level ? p : { x, y, level }));
    });
    return () => sub.remove();
  }, []);
  return { ...tilt, refs };
}
