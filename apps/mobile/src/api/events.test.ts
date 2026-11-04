import { countMetricResults, listMetricResults } from "./events";

const event = (payload: unknown) => ({ type: "metric-result", payload });

describe("events api", () => {
  afterEach(() => jest.restoreAllMocks());

  it("keeps only metric-result events", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => [
        { type: "quality-gate-flag", payload: {} },
        event({ metricKey: "static.head_lateral_tilt", estimate: { value: 1, uncertainty: 2 } }),
      ],
    }) as unknown as typeof fetch;

    const results = await listMetricResults("s-1", "tok");
    expect(results).toHaveLength(1);
    expect(results[0]!.metricKey).toBe("static.head_lateral_tilt");
  });

  it("sends the clinician token, since the events log is clinician-only", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    global.fetch = fetchMock as unknown as typeof fetch;

    await listMetricResults("s-1", "clin-tok");

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer clin-tok");
  });

  it("counts results so the analysis screen knows when to advance", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => [event({ metricKey: "a" }), event({ metricKey: "b" })],
    }) as unknown as typeof fetch;

    await expect(countMetricResults("s-1", "tok")).resolves.toBe(2);
  });

  it("returns zero when nothing has been analysed yet", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => [],
    }) as unknown as typeof fetch;

    await expect(countMetricResults("s-1", "tok")).resolves.toBe(0);
  });
});
