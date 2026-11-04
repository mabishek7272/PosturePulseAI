import { reportSymptom, SEVERITIES, SYMPTOMS } from "./symptoms";
import { setUnauthorizedHandler } from "./http";

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

function ok(body: unknown = { symptomReportId: "sr-1", state: "Pause" }) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function fail(status = 500) {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  setUnauthorizedHandler(null);
});

describe("reportSymptom", () => {
  it("posts the schema's shape to /symptom-reports and always asks for a pause", async () => {
    fetchMock.mockResolvedValue(ok());
    const result = await reportSymptom({
      sessionId: "s-1",
      symptoms: ["dizziness"],
      severity: "moderate",
      freeText: "went light-headed",
      token: "subj-tok",
    });

    expect(result).toEqual({ symptomReportId: "sr-1", state: "Pause" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/symptom-reports$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      sessionId: "s-1",
      symptoms: ["dizziness"],
      severity: "moderate",
      freeText: "went light-headed",
      // Never anything else: this client's job is to stop the session, and
      // escalation is the clinician's decision, not the patient's.
      triggeredAction: "pause",
    });
    expect(init.headers.Authorization).toBe("Bearer subj-tok");
  });

  it("sends freeText as null rather than omitting it", async () => {
    fetchMock.mockResolvedValue(ok());
    await reportSymptom({ sessionId: "s-1", symptoms: ["pain"], severity: "mild" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).freeText).toBeNull();
  });

  it("sends without a token rather than refusing to send", async () => {
    // The server never rejects this endpoint for auth - it accepts, pauses, and
    // only logs the auth status - because rejecting a real report would leave a
    // subject who feels unwell in an active session (ADR-012).
    fetchMock.mockResolvedValue(ok());
    await reportSymptom({ sessionId: "s-1", symptoms: ["pain"], severity: "severe" });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once on a network failure", async () => {
    // Every other call in this app fails to a visible error and the user tries
    // again. This one has a patient standing in front of it, so one dropped
    // packet must not be the difference between the clinician being told or not.
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(ok());
    await expect(
      reportSymptom({ sessionId: "s-1", symptoms: ["pain"], severity: "mild" })
    ).resolves.toMatchObject({ state: "Pause" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once on a server error", async () => {
    fetchMock.mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(ok());
    await expect(
      reportSymptom({ sessionId: "s-1", symptoms: ["pain"], severity: "mild" })
    ).resolves.toMatchObject({ state: "Pause" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry and surfaces the failure", async () => {
    fetchMock.mockResolvedValue(fail(500));
    await expect(
      reportSymptom({ sessionId: "s-1", symptoms: ["pain"], severity: "mild" })
    ).rejects.toThrow(/500/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT route a 401 into the unauthorized handler", async () => {
    // `request()` clears the stored token and bounces to login on a 401. Doing
    // that mid-report would discard the session the clinician needs to see, and
    // a 401 here would be a misconfiguration rather than an expired session.
    const handler = jest.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(fail(401));
    await expect(
      reportSymptom({ sessionId: "s-1", symptoms: ["pain"], severity: "mild" })
    ).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses an empty symptom list before it reaches the server", async () => {
    // The schema requires at least one. Without this the server would pause the
    // session and THEN fail validation, leaving a half-applied report.
    await expect(
      reportSymptom({ sessionId: "s-1", symptoms: [], severity: "mild" })
    ).rejects.toThrow(/at least one symptom/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("covers exactly the schema's enum values", async () => {
    // A value this client cannot send is a symptom a patient cannot report.
    expect([...SYMPTOMS]).toEqual(["pain", "dizziness", "weakness", "breathlessness", "other"]);
    expect([...SEVERITIES]).toEqual(["mild", "moderate", "severe"]);
  });
});
