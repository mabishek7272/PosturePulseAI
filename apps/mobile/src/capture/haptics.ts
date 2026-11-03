/**
 * Best-effort haptics. expo-haptics is loaded lazily so a build that lacks the
 * native module (or a simulator) simply stays silent instead of crashing the
 * capture screen. Never affects recording.
 */
type HapticsModule = typeof import("expo-haptics");
let mod: HapticsModule | null | undefined;

function haptics(): HapticsModule | null {
  if (mod === undefined) {
    try {
      mod = require("expo-haptics") as HapticsModule;
    } catch {
      mod = null;
    }
  }
  return mod;
}

export function tickHaptic(): void {
  try {
    void haptics()?.selectionAsync().catch(() => {});
  } catch {
    // ignore
  }
}

export function milestoneHaptic(): void {
  try {
    const h = haptics();
    void h?.impactAsync(h.ImpactFeedbackStyle.Light).catch(() => {});
  } catch {
    // ignore
  }
}

export function startHaptic(): void {
  try {
    const h = haptics();
    void h?.notificationAsync(h.NotificationFeedbackType.Success).catch(() => {});
  } catch {
    // ignore
  }
}

/** Hold went unsteady / misaligned (iPhone only: iPads have no Taptic Engine). */
export function warnHaptic(): void {
  try {
    const h = haptics();
    void h?.notificationAsync(h.NotificationFeedbackType.Warning).catch(() => {});
  } catch {
    // ignore
  }
}

/** Conditions are good again after a warning. */
export function recoveredHaptic(): void {
  startHaptic();
}

/** Recording has started. */
export function recordingStartHaptic(): void {
  try {
    const h = haptics();
    void h?.impactAsync(h.ImpactFeedbackStyle.Medium).catch(() => {});
  } catch {
    // ignore
  }
}
