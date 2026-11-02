/** Matches the login screen's own copy: "Sessions lock after 10 minutes idle." */
export const IDLE_LOCK_MS = 10 * 60 * 1000;

let lastActivityAt: number | null = null;

/** Called by a touch listener at the root layout on every touch, app-wide. */
export function recordActivity(): void {
  lastActivityAt = Date.now();
}

/**
 * False until the first recorded activity, so the app does not lock itself
 * the instant it opens, before anyone has touched it.
 */
export function isIdle(): boolean {
  if (lastActivityAt === null) return false;
  return Date.now() - lastActivityAt >= IDLE_LOCK_MS;
}

/** Test-only: clears module state between tests. */
export function resetIdleLockForTests(): void {
  lastActivityAt = null;
}
