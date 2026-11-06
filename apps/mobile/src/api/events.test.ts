import { countMetricResults, latestPerMetric, listMetricResults, listReportResults, rowToResult, type ReportRow } from "./events";

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

  const row = (extra: Partial<ReportRow> = {}): ReportRow => ({
    stepId: "static.anterior", metricKey: "static.shoulder_line_tilt", label: "Shoulder line tilt", tier: "proxy", unit: "deg",
    side: null, estimate: { value: 1.2, uncertainty: 0.5 }, reference: { label: "0°", value: 0 }, position: "indeterminate" as const,
    analysis: { text: "1.2° ± 0.5°. Overlaps the reference." }, ...extra,
  });

  it("reads report rows from the read-only preview, with reference and position", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows: [row()] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const results = await listReportResults("s-1", "tok");

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/sessions\/s-1\/report-preview$/);
    expect(results[0]).toMatchObject({ label: "Shoulder line tilt", position: "indeterminate", reference: { label: "0°" } });
  });

  it("falls back to raw results (latest per metric) when nothing can be reported yet", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 409, statusText: "Conflict", json: async () => ({ message: "nothing" }), url: "x" })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [
        event({ metricKey: "a", stepId: "s", estimate: { value: 1, uncertainty: 1 } }),
        event({ metricKey: "a", stepId: "s", estimate: { value: 2, uncertainty: 1 } }),
      ] }) as unknown as typeof fetch;

    const results = await listReportResults("s-1", "tok");
    expect(results).toHaveLength(1);
    expect(results[0]!.estimate!.value).toBe(2);
  });

  it("maps unsupported and not-measurable rows without inventing a value", () => {
    expect(rowToResult(row({ estimate: null, unsupportedReasons: ["subject_moving"], position: "not_applicable" })))
      .toMatchObject({ estimate: null, unsupported: { reasons: ["subject_moving"] }, notMeasurable: null });
    expect(rowToResult(row({ estimate: null, position: "not_applicable", analysis: { text: "Not measurable with this system: x" } })))
      .toMatchObject({ unsupported: null, notMeasurable: { reason: "Not measurable with this system: x" } });
  });

  it("keeps different sides and steps apart when de-duplicating", () => {
    expect(latestPerMetric([{ metricKey: "a", side: "left" }, { metricKey: "a", side: "right" }, { metricKey: "a", side: "left", stepId: "t" }])).toHaveLength(3);
  });
});
