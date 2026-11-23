import { afterEach, describe, expect, it, vi } from "vitest";
import { clearToken, getRefreshToken, getToken, setSession } from "../auth/tokenStore";
import { listSessions, login, logoutRequest } from "./client";

const res = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  json: () => Promise.resolve(body),
});

function stubFetch(handler: (url: string, init: RequestInit) => unknown) {
  const mock = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearToken();
});

describe("session refresh", () => {
  it("login returns both tokens, and setSession keeps both", async () => {
    stubFetch(() => res(200, { accessToken: "a1", refreshToken: "r1" }));
    const session = await login("drchen", "pw");
    setSession(session.accessToken, session.refreshToken);
    expect(getToken()).toBe("a1");
    expect(getRefreshToken()).toBe("r1");
  });

  it("renews on a 401, retries once with the new token, and stores the rotated pair", async () => {
    setSession("stale", "r1");
    const fetchMock = stubFetch((url, init) => {
      if (url.endsWith("/auth/refresh")) return res(200, { accessToken: "fresh", refreshToken: "r2" });
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === "Bearer fresh" ? res(200, [{ id: "s1" }]) : res(401);
    });

    await expect(listSessions()).resolves.toEqual([{ id: "s1" }]);

    expect(JSON.parse(fetchMock.mock.calls.find(([u]) => u.endsWith("/auth/refresh"))![1].body as string)).toEqual({ refreshToken: "r1" });
    expect(getToken()).toBe("fresh");
    expect(getRefreshToken()).toBe("r2");
  });

  it("shares one renewal between simultaneous 401s", async () => {
    setSession("stale", "r1");
    const fetchMock = stubFetch(async (url, init) => {
      if (url.endsWith("/auth/refresh")) return res(200, { accessToken: "fresh", refreshToken: "r2" });
      return (init.headers as Record<string, string>).Authorization === "Bearer fresh" ? res(200, []) : res(401);
    });

    await Promise.all([listSessions(), listSessions(), listSessions()]);

    expect(fetchMock.mock.calls.filter(([u]) => u.endsWith("/auth/refresh"))).toHaveLength(1);
  });

  it("signs out (clears both tokens) when the refresh token is refused", async () => {
    setSession("stale", "r1");
    stubFetch((url) => (url.endsWith("/auth/refresh") ? res(401) : res(401)));

    await expect(listSessions()).rejects.toThrow(/expired|Not logged in/);

    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it("does not sign out when the server is unreachable during renewal", async () => {
    setSession("stale", "r1");
    stubFetch((url) => {
      if (url.endsWith("/auth/refresh")) throw new TypeError("Failed to fetch");
      return res(401);
    });

    await expect(listSessions()).rejects.toThrow("Failed to fetch");

    expect(getToken()).toBe("stale");
    expect(getRefreshToken()).toBe("r1");
  });

  it("does not try to renew a request that carried no token", async () => {
    const fetchMock = stubFetch(() => res(401));
    await expect(listSessions()).rejects.toThrow();
    expect(fetchMock.mock.calls.some(([u]) => u.endsWith("/auth/refresh"))).toBe(false);
  });

  it("logout revokes the session on the server with the refresh token", async () => {
    setSession("a1", "r1");
    const fetchMock = stubFetch(() => res(204));
    await logoutRequest();
    expect(fetchMock.mock.calls[0]![0]).toMatch(/\/auth\/logout$/);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({ refreshToken: "r1" });
  });

  it("logout tolerates the server being unreachable", async () => {
    setSession("a1", "r1");
    stubFetch(() => { throw new TypeError("offline"); });
    await expect(logoutRequest()).resolves.toBeUndefined();
  });
});
