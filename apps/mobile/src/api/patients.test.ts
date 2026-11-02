import { createPatient, linkPatient, searchPatients } from "./patients";

describe("patients api", () => {
  afterEach(() => jest.restoreAllMocks());

  it("url-encodes the search query", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    global.fetch = fetchMock as unknown as typeof fetch;

    await searchPatients("de souza", "tok");

    expect(fetchMock.mock.calls[0][0]).toContain("/patients?q=de%20souza");
  });

  it("sends the clinician token when creating a patient", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ id: "p-9" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await createPatient({ name: "R Kumar", dateOfBirth: "1984-02-11" }, "tok");

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });

  it("sends intake alongside identity when the clinician provided it", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ id: "p-9" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await createPatient(
      { name: "R Kumar", dateOfBirth: "1984-02-11", intake: { heightCm: 172, smoking: "former" } },
      "tok"
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.intake).toEqual({ heightCm: 172, smoking: "former" });
  });

  it("links a visit pseudo-id to the patient record", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await linkPatient("p-9", "subj-1", "tok");

    expect(fetchMock.mock.calls[0][0]).toContain("/patients/p-9/link");
  });
});
