import { Injectable, InternalServerErrorException, UnprocessableEntityException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

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
}
