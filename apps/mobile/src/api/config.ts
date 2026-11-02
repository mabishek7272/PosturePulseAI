/** Overridable per build via EXPO_PUBLIC_BACKEND_URL; defaults to production. */
export const BACKEND_URL: string =
  process.env.EXPO_PUBLIC_BACKEND_URL ?? "https://posture.beaive.com";
