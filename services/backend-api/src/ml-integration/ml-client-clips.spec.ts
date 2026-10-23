import { ServiceUnavailableException } from "@nestjs/common";
import { MlClientService } from "./ml-client.service";

const config = { get: (key: string) => (key === "ML_SERVICE_URL" ? "http://ml:8000" : undefined) };
const client = () => new MlClientService(config as never);

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Partial<Response>>) {
  const fn = jest.fn(impl);
  (globalThis as { fetch: unknown }).fetch = fn;
  return fn;
}

const catalog = {
  metricsVersion: "metrics/v1",
  metrics: [
    {
      metricKey: "static.head_lateral_tilt",
      label: "Head tilt",
      module: "static",
      tier: "estimate",
      unit: "deg",
      side: null,
      signConvention: "positive = left side lower",
      description: "x",
    },
  ],
  notMeasurable: [{ metricKey: "static.q_angle", label: "Q-angle", reason: "r", whatWouldBeNeeded: "w" }],
};

describe("MlClientService.analyzeClip", () => {
  const request = {
    sessionId: "s1",
    clipId: "c1",
    stepId: "static.anterior",
    clipPath: "/data/clips/c1.mov",
    sidecar: { clipId: "c1" },
    metricKeys: ["static.head_lateral_tilt"],
    minFps: 24,
    levelToleranceDegrees: 3,
  };

  it("posts the request to /internal/clips/analyze and returns the body", async () => {
    const body = { results: [], landmarkSeries: { path: "p", sha256: "a".repeat(64) }, frameQuality: { usable: 1, total: 1, reasons: [] } };
    const fetchMock = mockFetch(async () => ({ ok: true, status: 200, json: async () => body }));
    await expect(client().analyzeClip(request)).resolves.toEqual(body);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://ml:8000/internal/clips/analyze");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual(request);
  });

  it("throws on a non-2xx answer so the job runner can retry", async () => {
    mockFetch(async () => ({ ok: false, status: 500, text: async () => "boom" }));
    await expect(client().analyzeClip(request)).rejects.toThrow(/500/);
  });
});

describe("MlClientService.getMetricCatalog", () => {
  it("returns the catalog from /internal/metrics/catalog", async () => {
    const fetchMock = mockFetch(async () => ({ ok: true, status: 200, json: async () => catalog }));
    await expect(client().getMetricCatalog()).resolves.toEqual(catalog);
    expect(fetchMock.mock.calls[0][0]).toBe("http://ml:8000/internal/metrics/catalog");
  });

  it("is a 503 when ml-service cannot be reached", async () => {
    mockFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(client().getMetricCatalog()).rejects.toThrow(ServiceUnavailableException);
  });

  it("is a 503 on a non-2xx answer", async () => {
    mockFetch(async () => ({ ok: false, status: 502, text: async () => "bad gateway" }));
    await expect(client().getMetricCatalog()).rejects.toThrow(ServiceUnavailableException);
  });

  it("is a 503 when the body is not a catalog (labels are never invented)", async () => {
    mockFetch(async () => ({ ok: true, status: 200, json: async () => ({ metrics: "nope" }) }));
    await expect(client().getMetricCatalog()).rejects.toThrow(ServiceUnavailableException);
  });
});
