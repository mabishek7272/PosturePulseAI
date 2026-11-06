import { getMetricCatalog, resetMetricCatalogCache } from "./catalog";

describe("getMetricCatalog", () => {
  afterEach(() => {
    resetMetricCatalogCache();
    jest.restoreAllMocks();
  });

  it("fetches once with the clinician token and reuses the answer", async () => {
    const body = { metricsVersion: "metrics/v2", metrics: [] };
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    global.fetch = fetchMock as unknown as typeof fetch;
    await getMetricCatalog("tok");
    await getMetricCatalog("tok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/metric-catalog$/);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });

  it("does not cache a failure", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: "x", json: async () => ({ message: "down" }), url: "u" })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ metricsVersion: "v", metrics: [] }) }) as unknown as typeof fetch;
    await expect(getMetricCatalog("tok")).rejects.toThrow();
    await expect(getMetricCatalog("tok")).resolves.toMatchObject({ metricsVersion: "v" });
  });
});
