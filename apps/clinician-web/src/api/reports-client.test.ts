import { afterEach, describe, expect, it, vi } from "vitest";
import { clearToken, getToken, setToken } from "../auth/tokenStore";
import {
  buildDraftReport,
  createPatient,
  excludeReportRow,
  getAssessmentBattery,
  getReport,
  listPatientSessions,
  listReports,
  rejectReport,
  saveClinicianAssessment,
  searchPatients,
  signOffReport,
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

function postInit(body: unknown, token = "the.jwt.token") {
  return {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearToken();
});

describe("api client - M1 report review", () => {
  it("getAssessmentBattery hits GET /assessment-battery", async () => {
    mockFetchOnce({ version: "assessment-battery/v0-draft", steps: [] });
    await getAssessmentBattery();
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/assessment-battery", { headers: {} });
  });

  it("listReports passes the status filter", async () => {
    mockFetchOnce([]);
    await listReports("draft");
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/reports?status=draft", { headers: {} });
  });

  it("listReports without a filter has no query", async () => {
    mockFetchOnce([]);
    await listReports();
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/reports", { headers: {} });
  });

  it("getReport hits GET /reports/:id", async () => {
    mockFetchOnce({ id: "r1" });
    await getReport("r1");
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/reports/r1", { headers: {} });
  });

  it("buildDraftReport posts to /sessions/:id/report with the bearer token", async () => {
    setToken("the.jwt.token");
    mockFetchOnce({ id: "r2" });
    const result = await buildDraftReport("s1");
    expect(result).toEqual({ id: "r2" });
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/sessions/s1/report", postInit({}));
  });

  it("excludeReportRow posts metricKey, side, stepId and reason", async () => {
    setToken("the.jwt.token");
    mockFetchOnce({ id: "r1" });
    const exclusion = { metricKey: "static.hip_line_tilt", side: null, stepId: "static.anterior", reason: "Clothing" };
    await excludeReportRow("r1", exclusion);
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/reports/r1/rows/exclude", postInit(exclusion));
  });

  it("saveClinicianAssessment posts the text", async () => {
    setToken("the.jwt.token");
    mockFetchOnce({ id: "r1" });
    await saveClinicianAssessment("r1", "My notes");
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/reports/r1/assessment", postInit({ text: "My notes" }));
  });

  it("signOffReport posts the password", async () => {
    setToken("the.jwt.token");
    mockFetchOnce({ id: "r1" });
    await signOffReport("r1", "secret");
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/reports/r1/sign-off", postInit({ password: "secret" }));
  });

  it("signOffReport keeps the login on 401 (a rejected password must not log the clinician out)", async () => {
    setToken("the.jwt.token");
    mockFetchOnce({ message: "bad password" }, false, 401);
    await expect(signOffReport("r1", "wrong")).rejects.toThrow(/not accepted/i);
    expect(getToken()).toBe("the.jwt.token");
  });

  it("other POSTs clear the token on 401 like GETs do", async () => {
    setToken("stale.token");
    mockFetchOnce({}, false, 401);
    await expect(rejectReport("r1", "Wrong person")).rejects.toThrow(/log in again/i);
    expect(getToken()).toBeNull();
  });

  it("rejectReport posts the reason", async () => {
    setToken("the.jwt.token");
    mockFetchOnce({ id: "r1" });
    await rejectReport("r1", "Wrong person");
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/reports/r1/reject", postInit({ reason: "Wrong person" }));
  });

  it("a failed POST surfaces the server's message", async () => {
    setToken("the.jwt.token");
    mockFetchOnce({ message: "Report is not a draft" }, false, 409);
    await expect(rejectReport("r1", "x")).rejects.toThrow(/409.*Report is not a draft/);
  });
});

describe("api client - patient register", () => {
  it("searchPatients encodes the query", async () => {
    mockFetchOnce([]);
    await searchPatients("ann lee");
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/patients?q=ann%20lee", { headers: {} });
  });

  it("createPatient posts name, dateOfBirth and contact", async () => {
    setToken("the.jwt.token");
    mockFetchOnce({ id: "p1" });
    const input = { name: "Ann Lee", dateOfBirth: "1980-02-03", contact: "ann@example.org" };
    await createPatient(input);
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/patients", postInit(input));
  });

  it("listPatientSessions hits GET /patients/:id/sessions", async () => {
    mockFetchOnce([]);
    await listPatientSessions("p1");
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/patients/p1/sessions", { headers: {} });
  });
});
