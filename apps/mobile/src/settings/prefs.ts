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
