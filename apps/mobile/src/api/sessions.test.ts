import { createConsentRecord, createSession, signConsentRecord } from "./sessions";

describe("sessions api", () => {
  afterEach(() => jest.restoreAllMocks());

  it("requests the derived_events scope, without which session creation is refused", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ id: "c-1" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await createConsentRecord("subj-1");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][0]).toContain("/consent-records");
    expect(body.scopes).toContain("derived_events");
  });

  it("does not request raw_video, because P1 does not retain raw video", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ id: "c-1" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await createConsentRecord("subj-1");

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).scopes).not.toContain("raw_video");
  });

  it("reads the consent record id from the response's `id` field, not `consentRecordId`", async () => {
    // POST /consent-records returns the raw Prisma row (keyed by `id`), not
    // the consentRecordId-keyed shape consent-record.schema.json describes -
    // that shape is used only for server-side validation and is never
    // returned. Confirmed against apps/ios-client's ConsentView, which reads
    // record.id. Getting this wrong makes consentRecordId undefined
    // everywhere downstream, which the server then rejects opaquely.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ id: "c-1", subjectPseudoId: "subj-1", scopes: [] }),
    }) as unknown as typeof fetch;

    await expect(createConsentRecord("subj-1")).resolves.toEqual(
      expect.objectContaining({ id: "c-1" })
    );
  });

  it("creates a clinic_supervised session and returns both the session and its token", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ session: { id: "s-1" }, sessionToken: "subj-tok" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await createSession({
      subjectPseudoId: "subj-1", consentRecordId: "c-1", protocolVersion: "v0-draft",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.deploymentContext).toBe("clinic_supervised");
    expect(body.retentionPolicy.rawVideo.optIn).toBe(false);
    expect(result.sessionToken).toBe("subj-tok");
  });
});

describe("signConsentRecord", () => {
  afterEach(() => jest.restoreAllMocks());

  it("posts both signatures with the clinician token to the record's signatures route", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ consentRecordId: "c1", signedAt: "t" }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await signConsentRecord("c1", { subjectSvgPath: "M1 1L2 2", clinicianSvgPath: "M3 3L4 4" }, "clin-tok");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/consent-records\/c1\/signatures$/);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer clin-tok");
    expect(JSON.parse(init.body)).toEqual({ subjectSvgPath: "M1 1L2 2", clinicianSvgPath: "M3 3L4 4" });
  });
});
