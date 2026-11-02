import * as SecureStore from "expo-secure-store";

const CLINICIAN_KEY = "beaive.clinicianToken";

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

export async function clearClinicianToken(): Promise<void> {
  await SecureStore.deleteItemAsync(CLINICIAN_KEY);
}
