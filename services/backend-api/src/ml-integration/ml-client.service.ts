import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { MetricCatalog, MetricResult } from "../battery/types";

export interface FrameSubmission {
  sessionId: string;
  frameId: string;
  capturedAt: string;
  imageBase64: string;
  /** Resolved by backend-api (owns Session/ScaleCalibrationRecord data) - see SessionsService. */
  scaleCalibrationRef?: string | null;
}

export interface MlFrameResult {
  poseLandmarkFrame: unknown;
  qualityGateFlag: unknown;
  /** null when the frame had zero computable angles (e.g. fully occluded) - never fabricated. */
  calibratedJointFrame: unknown | null;
  /** Not a schema record itself - a plain hint consumed by ExposureAggregatorService. null when there's nothing to classify. */
  postureBucketHint: string | null;
}

/** POST /internal/clips/analyze (ADR-013). clipPath is a file on the volume both services mount. */
export interface ClipAnalysisRequest {
  sessionId: string;
  clipId: string;
  stepId: string;
  clipPath: string;
  sidecar: unknown;
  metricKeys: string[];
  minFps: number;
  levelToleranceDegrees?: number;
}

export interface ClipAnalysisResponse {
  results: MetricResult[];
  landmarkSeries: { path: string; sha256: string };
  frameQuality: { usable: number; total: number; reasons: string[] };
}

const ANALYZE_TIMEOUT_MS = 5 * 60 * 1000;
const CATALOG_TIMEOUT_MS = 10 * 1000;

/** Thin HTTP client to ml-service's internal API (ADR-003: synchronous REST for this phase). */
@Injectable()
export class MlClientService {
  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.get<string>("ML_SERVICE_URL") ?? "http://localhost:8000";
  }

  async sendFrame(submission: FrameSubmission): Promise<MlFrameResult> {
    const response = await fetch(`${this.baseUrl}/internal/frames`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submission),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      throw new InternalServerErrorException(`ml-service returned ${response.status}: ${text}`);
    }

    return (await response.json()) as MlFrameResult;
  }

  async calibrateScale(input: {
    sessionId: string;
    frameId: string;
    imageBase64: string;
    subjectHeightMeters: number;
  }): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/internal/calibrate-scale`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });

    if (response.status === 422) {
      const body = await response.json().catch(() => ({ detail: "Could not compute a scale calibration." }));
      throw new UnprocessableEntityException(body.detail ?? body);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      throw new InternalServerErrorException(`ml-service returned ${response.status}: ${text}`);
    }

    return response.json();
  }

  /** Separate, low-cadence call (ADR - object detection is sampled far less often than pose). */
  async detectObjects(input: { sessionId: string; frameId: string; imageBase64: string }): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/internal/detect-objects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      throw new InternalServerErrorException(`ml-service returned ${response.status}: ${text}`);
    }
    return response.json();
  }

  async sendMovementWindow(input: {
    sessionId: string;
    exerciseId: string;
    windowStartAt: string;
    windowEndAt: string;
    jointAngleSequence: unknown[][];
    sourceFrameIds: string[];
    modelArchitecture?: "tcn" | "st-gcn";
  }): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/internal/movement-window`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      throw new InternalServerErrorException(`ml-service returned ${response.status}: ${text}`);
    }
    return response.json();
  }

  /** Throws on any failure; the job runner retries. Content problems come back as unsupported results, not errors. */
  async analyzeClip(request: ClipAnalysisRequest): Promise<ClipAnalysisResponse> {
    const response = await fetch(`${this.baseUrl}/internal/clips/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(ANALYZE_TIMEOUT_MS),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      throw new Error(`ml-service returned ${response.status} for clip analysis: ${text.slice(0, 300)}`);
    }
    return (await response.json()) as ClipAnalysisResponse;
  }

  /**
   * The labels, tiers and units of every metric, plus the standing list of
   * things that cannot be measured. Report building needs it; if it is not
   * available the caller gets a 503 and no label is invented.
   */
  async getMetricCatalog(): Promise<MetricCatalog> {
    let body: unknown;
    try {
      const response = await fetch(`${this.baseUrl}/internal/metrics/catalog`, {
        signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      body = await response.json();
    } catch (error) {
      throw new ServiceUnavailableException(
        `The metric catalog is not available from ml-service (${(error as Error).message}); try again shortly.`
      );
    }
    const catalog = body as Partial<MetricCatalog> | null;
    if (!catalog || typeof catalog.metricsVersion !== "string" || !Array.isArray(catalog.metrics) || !Array.isArray(catalog.notMeasurable)) {
      throw new ServiceUnavailableException("ml-service returned a metric catalog in an unexpected shape.");
    }
    return catalog as MetricCatalog;
  }
}
