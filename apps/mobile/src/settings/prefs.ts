import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";

const SKELETON_KEY = "pp.pref.skeletonOverlay";

/** Stored form: "1" / "0". Anything else (missing, corrupt) falls back to `fallback`. */
export function parseBoolPref(raw: string | null | undefined, fallback: boolean): boolean {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return fallback;
}

export function serialiseBoolPref(value: boolean): string {
  return value ? "1" : "0";
}

type Listener = (value: boolean) => void;
const listeners = new Set<Listener>();

/** Read the persisted preference (default ON). Never throws. */
export async function readSkeletonOverlayPref(): Promise<boolean> {
  try {
    return parseBoolPref(await SecureStore.getItemAsync(SKELETON_KEY), true);
  } catch {
    return true;
  }
}

export async function writeSkeletonOverlayPref(value: boolean): Promise<void> {
  try {
    await SecureStore.setItemAsync(SKELETON_KEY, serialiseBoolPref(value));
  } catch {
    // Storage unavailable: the in-memory value still applies for this run.
  }
  listeners.forEach((l) => l(value));
}

/** [value, setValue] for the capture pose-guide skeleton overlay. Defaults to ON until the stored value loads. */
export function useSkeletonOverlayPref(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(true);
  useEffect(() => {
    let cancelled = false;
    readSkeletonOverlayPref().then((v) => {
      if (!cancelled) setValue(v);
    });
    listeners.add(setValue);
    return () => {
      cancelled = true;
      listeners.delete(setValue);
    };
  }, []);
  const set = useCallback((next: boolean) => {
    setValue(next);
    void writeSkeletonOverlayPref(next);
  }, []);
  return [value, set];
}

// ---- Live capture guidance (AR framing hints + checks on the capture screen) ----

const GUIDANCE_KEY = "pp.pref.captureGuidance";
const guidanceListeners = new Set<Listener>();

/** Read the persisted preference (default ON). Never throws. */
export async function readCaptureGuidancePref(): Promise<boolean> {
  try {
    return parseBoolPref(await SecureStore.getItemAsync(GUIDANCE_KEY), true);
  } catch {
    return true;
  }
}

export async function writeCaptureGuidancePref(value: boolean): Promise<void> {
  try {
    await SecureStore.setItemAsync(GUIDANCE_KEY, serialiseBoolPref(value));
  } catch {
    // Storage unavailable: the in-memory value still applies for this run.
  }
  guidanceListeners.forEach((l) => l(value));
}

/** [value, setValue] for live capture guidance. Defaults to ON until the stored value loads. */
export function useCaptureGuidancePref(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(true);
  useEffect(() => {
    let cancelled = false;
    readCaptureGuidancePref().then((v) => {
      if (!cancelled) setValue(v);
    });
    guidanceListeners.add(setValue);
    return () => {
      cancelled = true;
      guidanceListeners.delete(setValue);
    };
  }, []);
  const set = useCallback((next: boolean) => {
    setValue(next);
    void writeCaptureGuidancePref(next);
  }, []);
  return [value, set];
}

// ---- Haptic feedback during the hold (buzz when the hold is not steady; iPhone only) ----

const HAPTIC_KEY = "pp.pref.hapticFeedback";
const hapticListeners = new Set<Listener>();

/** Read the persisted preference (default ON). Never throws. */
export async function readHapticFeedbackPref(): Promise<boolean> {
  try {
    return parseBoolPref(await SecureStore.getItemAsync(HAPTIC_KEY), true);
  } catch {
    return true;
  }
}

export async function writeHapticFeedbackPref(value: boolean): Promise<void> {
  try {
    await SecureStore.setItemAsync(HAPTIC_KEY, serialiseBoolPref(value));
  } catch {
    // Storage unavailable: the in-memory value still applies for this run.
  }
  hapticListeners.forEach((l) => l(value));
}

/** [value, setValue] for hold haptic feedback. Defaults to ON until the stored value loads. */
export function useHapticFeedbackPref(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(true);
  useEffect(() => {
    let cancelled = false;
    readHapticFeedbackPref().then((v) => {
      if (!cancelled) setValue(v);
    });
    hapticListeners.add(setValue);
    return () => {
      cancelled = true;
      hapticListeners.delete(setValue);
    };
  }, []);
  const set = useCallback((next: boolean) => {
    setValue(next);
    void writeHapticFeedbackPref(next);
  }, []);
  return [value, set];
}

// ---- Guided (AR) capture: the ARKit spatial gate + LiDAR depth path ----
//
// DEFAULTS TO ON (changed 2026-11-06, after the first iPad test scan reported
// "AR is missing": with the default off, nobody ever saw it).
//
// The gate thresholds (distance 2.3-3.0 m, camera height 0.9-1.3 m, tilt,
// floor clearance) are still engineering defaults, not tuned in a real clinic
// room. A too-strict threshold does not mis-measure anything - it delays the
// record button - and the gate now smooths tilt and tolerates brief blips
// (ARJigStabiliser), so the remaining risk is a slow setup, not a wrong value.
// The switch in Settings still turns it off.
//
// No effect on a device without ARKit world tracking: the capture screen checks
// `ARJigModule.isSupported` too and falls back to the standard camera path. A
// device without LiDAR still runs it; only the depth track is absent.

const AR_JIG_KEY = "pp.pref.arJigCapture";
const arJigListeners = new Set<Listener>();

/** Read the persisted preference (default ON - see above). Never throws. */
export async function readArJigCapturePref(): Promise<boolean> {
  try {
    return parseBoolPref(await SecureStore.getItemAsync(AR_JIG_KEY), true);
  } catch {
    return true;
  }
}

export async function writeArJigCapturePref(value: boolean): Promise<void> {
  try {
    await SecureStore.setItemAsync(AR_JIG_KEY, serialiseBoolPref(value));
  } catch {
    // Storage unavailable: the in-memory value still applies for this run.
  }
  arJigListeners.forEach((l) => l(value));
}

/**
 * `[value, setValue]` for guided (AR) capture. Starts OFF until the stored
 * value loads (then ON unless the clinician turned it off), so the screen never
 * mounts the AR view and immediately swaps it out.
 */
export function useArJigCapturePref(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(false);
  useEffect(() => {
    let cancelled = false;
    readArJigCapturePref().then((v) => {
      if (!cancelled) setValue(v);
    });
    arJigListeners.add(setValue);
    return () => {
      cancelled = true;
      arJigListeners.delete(setValue);
    };
  }, []);
  const set = useCallback((next: boolean) => {
    setValue(next);
    void writeArJigCapturePref(next);
  }, []);
  return [value, set];
}
