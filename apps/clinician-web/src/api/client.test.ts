import { afterEach, describe, expect, it, vi } from "vitest";
import { clearToken, setToken } from "../auth/tokenStore";
import {
  getExposureSummary,
  getPilotMetrics,
  getSession,
  listAdverseEvents,
  listAuditLog,
  listEvents,
  listSessions,
  login,
} from "./client";

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status,
      statusText: ok ? "OK" : "Error",
      json: () => Promise.resolve(body),
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearToken();
});

describe("api client", () => {
  it("listSessions hits GET /sessions with no query when no filter is given", async () => {
    mockFetchOnce([{ id: "s1" }]);
    const result = await listSessions();
    expect(result).toEqual([{ id: "s1" }]);
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/sessions", { headers: {} });
  });

  it("listSessions passes a state filter as a query param", async () => {
    mockFetchOnce([]);
    await listSessions("Pause");
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/sessions?state=Pause", { headers: {} });
  });

  it("getSession hits GET /sessions/:id", async () => {
    mockFetchOnce({ id: "s1" });
    await getSession("s1");
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/sessions/s1", { headers: {} });
  });

  it("listEvents hits GET /sessions/:id/events", async () => {
    mockFetchOnce([]);
    await listEvents("s1");
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/sessions/s1/events", { headers: {} });
  });

  it("getExposureSummary hits GET /sessions/:id/exposure/summary", async () => {
    mockFetchOnce({});
    await getExposureSummary("s1");
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/sessions/s1/exposure/summary", { headers: {} });
  });

  it("throws on a non-ok response rather than silently returning bad data", async () => {
    mockFetchOnce({ message: "not found" }, false, 404);
    await expect(getSession("missing")).rejects.toThrow(/404/);
  });

  it("attaches a bearer token when one is set", async () => {
    setToken("the.jwt.token");
    mockFetchOnce([]);
    await listSessions();
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/sessions", {
      headers: { Authorization: "Bearer the.jwt.token" },
    });
  });

  it("clears the token and throws a clear message on 401, rather than surfacing a raw HTTP error", async () => {
    setToken("stale.token");
    mockFetchOnce({}, false, 401);
    await expect(getSession("s1")).rejects.toThrow(/log in again/i);
    // A subsequent call must not still send the stale token.
    mockFetchOnce([]);
    await listSessions();
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/sessions", { headers: {} });
  });

  it("login posts credentials and returns the access token", async () => {
    mockFetchOnce({ accessToken: "the.jwt.token" });
    const result = await login("drchen", "the-password");
    expect(result).toEqual({ accessToken: "the.jwt.token" });
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "drchen", password: "the-password" }),
    });
  });

  it("login surfaces an invalid-credentials message on 401", async () => {
    mockFetchOnce({}, false, 401);
    await expect(login("drchen", "wrong")).rejects.toThrow(/invalid username or password/i);
  });

  it("listAuditLog hits GET /audit-log with no query when no limit is given", async () => {
    mockFetchOnce([]);
    await listAuditLog();
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/audit-log", { headers: {} });
  });

  it("listAuditLog passes a limit as a query param", async () => {
    mockFetchOnce([]);
    await listAuditLog(50);
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/audit-log?limit=50", { headers: {} });
  });

  it("getPilotMetrics hits GET /pilot-metrics", async () => {
    mockFetchOnce({});
    await getPilotMetrics();
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/pilot-metrics", { headers: {} });
  });

  it("listAdverseEvents hits GET /adverse-events with no query by default", async () => {
    mockFetchOnce([]);
    await listAdverseEvents();
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/adverse-events", { headers: {} });
  });

  it("listAdverseEvents passes seriousOnly as a query param", async () => {
    mockFetchOnce([]);
    await listAdverseEvents(true);
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/adverse-events?seriousOnly=true", { headers: {} });
  });
});
