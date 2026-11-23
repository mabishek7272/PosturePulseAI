import { BACKEND_URL } from "./config";
import { request } from "./http";

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** ISO timestamp after which the refresh token stops working (30 days from issue). */
  refreshTokenExpiresAt: string;
}

export function login(username: string, password: string): Promise<Session> {
  return request<Session>("/auth/login", { method: "POST", body: { username, password } });
}

/** Rotates the refresh token: the one sent is spent, a new pair comes back. */
export function refreshSession(refreshToken: string): Promise<Session> {
  return request<Session>("/auth/refresh", { method: "POST", body: { refreshToken }, skipUnauthorizedHandler: true });
}

/** Revokes the session server-side. 204 with no body, so it cannot go through request()'s JSON parse. */
export async function logoutSession(refreshToken: string): Promise<void> {
  await fetch(`${BACKEND_URL}/auth/logout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
}
