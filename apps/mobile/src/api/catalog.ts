import { request } from "./http";

/** One entry of GET /metric-catalog (ml-service's catalog, fields the app reads). */
export interface CatalogMetric {
  metricKey: string;
  label: string;
  signConvention: string;
  description: string;
  /** Present for 2D metrics. */
  formula?: string;
}

export interface MetricCatalog {
  metricsVersion: string;
  methodNote?: string;
  metrics: CatalogMetric[];
}

let cached: Promise<MetricCatalog> | null = null;

/**
 * The metric catalog, fetched once per app run (it only changes with a server
 * deploy). A failed fetch is not cached, so the next screen can try again.
 */
export function getMetricCatalog(token: string): Promise<MetricCatalog> {
  if (!cached) {
    cached = request<MetricCatalog>("/metric-catalog", { token }).catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}

/** Test hook. */
export function resetMetricCatalogCache(): void {
  cached = null;
}
