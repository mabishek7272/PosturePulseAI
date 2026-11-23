import * as SecureStore from "expo-secure-store";

const CLINICIAN_KEY = "beaive.clinicianToken";
const REFRESH_KEY = "beaive.clinicianRefreshToken";

/**
 * The clinician JWT authorises /patients, /sessions and the events log. It is
 * NOT accepted for clip upload - that needs the per-session subject token
 * returned by POST /sessions, which lives only in memory for the duration of
 * a scan and is deliberately never persisted.
 */
export async function saveClinicianToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(CLINICIAN_KEY, token);
}

export async function getClinicianToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(CLINICIAN_KEY);
  } catch {
    // A locked or unavailable keychain means "not logged in", not a crash.
    return null;
  }
}

/**
 * The rotating 30-day refresh token lives in the iOS Keychain beside the access token. It is what lets
 * the app renew the short-lived access token without sending the clinician back to the login screen.
 */
export async function saveRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_KEY, token);
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_KEY);
  } catch {
    return null;
  }
}

/** Signing out (or locking) forgets both tokens. Server-side revocation is `endSession()`'s job. */
export async function clearClinicianToken(): Promise<void> {
  await SecureStore.deleteItemAsync(CLINICIAN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}
