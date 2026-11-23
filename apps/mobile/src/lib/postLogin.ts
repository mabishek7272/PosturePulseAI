// Where to send a clinician right after signing in. Kept pure so the rule
// "a profile problem never blocks sign-in" is a tested fact, not a code path.

export type PostLoginRoute = "/doctor-profile?setup=1" | "/permissions";

/**
 * - profile incomplete -> the one-time profile setup
 * - profile complete   -> permissions (then home)
 * - profile unreadable (network, server error) -> permissions: the doctor is NOT blocked from
 *   signing in; the profile is asked for again at the first action that needs it (sign-off, registering a patient).
 */
export async function resolvePostLoginRoute(getProfile: () => Promise<{ complete: boolean }>): Promise<PostLoginRoute> {
  try {
    const profile = await getProfile();
    return profile.complete ? "/permissions" : "/doctor-profile?setup=1";
  } catch {
    return "/permissions";
  }
}
