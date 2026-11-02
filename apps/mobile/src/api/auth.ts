import { request } from "./http";

export async function login(username: string, password: string): Promise<string> {
  const result = await request<{ accessToken: string }>("/auth/login", {
    method: "POST",
    body: { username, password },
  });
  return result.accessToken;
}
