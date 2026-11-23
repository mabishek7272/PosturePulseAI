import { logoutSession, refreshSession, type Session } from "../api/auth";
import { UnauthorizedError } from "../api/http";
import { clearClinicianToken, getRefreshToken, saveClinicianToken, saveRefreshToken } from "./tokenStore";

/**
 * The access token most recently stored by this app run. When a call fails with a token that is
 * no longer the latest, another call has already renewed it: use that instead of rotating the
 * refresh token a second time.
 */
let latestAccessToken: string | null = null;
let inFlight: Promise<string | null> | null = null;

export async function saveSession(session: Pick<Session, "accessToken" | "refreshToken">): Promise<void> {
  latestAccessToken = session.accessToken;
  await saveClinicianToken(session.accessToken);
  await saveRefreshToken(session.refreshToken);
}

/**
 * Renews the access token with the stored refresh token (which rotates). One renewal at a time:
 * concurrent 401s share it, because a second use of the spent refresh token would look like theft
 * to the server and end the whole session.
 *
 * Resolves null when the session is over (no refresh token, or the server refused it). Rejects when the
 * server cannot be reached, so being offline never signs anyone out.
 */
export function refreshAccessToken(staleToken: string): Promise<string | null> {
  if (latestAccessToken && latestAccessToken !== staleToken) return Promise.resolve(latestAccessToken);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) return null;
    try {
      const session = await refreshSession(refreshToken);
      await saveSession(session);
      return session.accessToken;
    } catch (err) {
      if (err instanceof UnauthorizedError) return null; // expired, revoked or reuse-detected
      throw err;
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Signing out or locking: revoke the session on the server (best effort, it must not block or fail the
 * lock), then forget both tokens on this device.
 */
export async function endSession(): Promise<void> {
  const refreshToken = await getRefreshToken();
  latestAccessToken = null;
  if (refreshToken) {
    try {
      await logoutSession(refreshToken);
    } catch {
      // Offline: the token still expires on its own and the device forgets it below.
    }
  }
  await clearClinicianToken();
}

export function resetSessionForTests(): void {
  latestAccessToken = null;
  inFlight = null;
}
