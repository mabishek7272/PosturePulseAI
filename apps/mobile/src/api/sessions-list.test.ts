import { listSessions } from "./sessions-list";

describe("listSessions", () => {
  afterEach(() => jest.restoreAllMocks());

  it("sends the clinician token and an optional limit", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    global.fetch = fetchMock as unknown as typeof fetch;

    await listSessions("tok", 20);

    expect(fetchMock.mock.calls[0][0]).toContain("/sessions?limit=20");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });

  it("omits the limit query param when none is given", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    global.fetch = fetchMock as unknown as typeof fetch;

    await listSessions("tok");

    expect(fetchMock.mock.calls[0][0]).not.toContain("limit");
  });

  it("returns the sessions as given", async () => {
    const sessions = [{ id: "s-1", state: "Observing", createdAt: "2026-11-01T10:00:00.000Z", protocolId: "assessment-battery", subjectPseudoId: "subj-1" }];
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => sessions }) as unknown as typeof fetch;

    await expect(listSessions("tok")).resolves.toEqual(sessions);
  });
});
