import { Injectable, Logger } from "@nestjs/common";
import { v4 as uuid } from "uuid";
import { EventsService } from "../events/events.service";
import { SessionGateway } from "../ws/session.gateway";

interface EvidenceRef {
  type: "calibrated-joint-frame" | "quality-gate-flag";
  refId: string;
}

interface WindowState {
  bucket: string;
  windowStartAt: Date;
  lastFrameAt: Date;
  validSeconds: number;
  totalWindowSeconds: number;
  evidence: EvidenceRef[];
}

// Placeholder values - not clinically derived. A window flushes on bucket
// change or once it reaches this length, whichever comes first.
const MAX_WINDOW_SECONDS = 60;
// Caps the elapsed-time contribution of a single frame gap, so a dropped
// connection or a long pause between submissions doesn't get counted as real
// exposure time.
const MAX_FRAME_GAP_SECONDS = 5;

/**
 * "Valid time spent in a defined posture bucket" (TRD 2.1) - NOT an inferred
 * tissue-load/dose estimate. validSeconds only accrues while the frame's
 * QualityGateFlag was 'supported'; unsupported time is tracked in
 * totalWindowSeconds but excluded from validSeconds, never fabricated as
 * bucket time.
 */
@Injectable()
export class ExposureAggregatorService {
  private readonly logger = new Logger(ExposureAggregatorService.name);
  private readonly windows = new Map<string, WindowState>();

  constructor(
    private readonly events: EventsService,
    private readonly gateway: SessionGateway
  ) {}

  async recordFrame(
    sessionId: string,
    postureBucketHint: string | null,
    qualitySupported: boolean,
    capturedAt: Date,
    evidenceCandidate: EvidenceRef
  ): Promise<unknown | null> {
    // Nothing to classify this frame - never fabricate a bucket.
    if (postureBucketHint === null) return null;

    const existing = this.windows.get(sessionId);

    if (!existing) {
      this.windows.set(sessionId, this.startWindow(postureBucketHint, capturedAt, evidenceCandidate));
      return null;
    }

    // Accrue the interval since the last frame into the window that was
    // active going into this frame, BEFORE deciding whether this frame's
    // bucket change or window-length overflow should flush it - a bucket
    // change must not discard the elapsed time that preceded it. We only
    // sample discretely, so this frame's own quality state is used for the
    // whole trailing interval (a documented simplification, not a rigorous
    // per-instant measurement).
    const elapsedSeconds = Math.min(
      Math.max((capturedAt.getTime() - existing.lastFrameAt.getTime()) / 1000, 0),
      MAX_FRAME_GAP_SECONDS
    );
    existing.totalWindowSeconds += elapsedSeconds;
    if (qualitySupported) existing.validSeconds += elapsedSeconds;
    existing.lastFrameAt = capturedAt;

    if (existing.bucket !== postureBucketHint) {
      const flushed = await this.flush(sessionId, existing, capturedAt);
      this.windows.set(sessionId, this.startWindow(postureBucketHint, capturedAt, evidenceCandidate));
      return flushed;
    }

    if (!existing.evidence.some((e) => e.refId === evidenceCandidate.refId)) {
      existing.evidence.push(evidenceCandidate);
    }

    if (existing.totalWindowSeconds >= MAX_WINDOW_SECONDS) {
      const flushed = await this.flush(sessionId, existing, capturedAt);
      this.windows.set(sessionId, this.startWindow(postureBucketHint, capturedAt, evidenceCandidate));
      return flushed;
    }

    return null;
  }

  private startWindow(bucket: string, capturedAt: Date, evidence: EvidenceRef): WindowState {
    return {
      bucket,
      windowStartAt: capturedAt,
      lastFrameAt: capturedAt,
      validSeconds: 0,
      totalWindowSeconds: 0,
      evidence: [evidence],
    };
  }

  private async flush(sessionId: string, window: WindowState, windowEndAt: Date): Promise<unknown | null> {
    if (window.evidence.length === 0) return null;

    const exposureEvent = {
      exposureEventId: uuid(),
      sessionId,
      postureBucket: window.bucket,
      windowStartAt: window.windowStartAt.toISOString(),
      windowEndAt: windowEndAt.toISOString(),
      validSeconds: window.validSeconds,
      totalWindowSeconds: window.totalWindowSeconds,
      evidence: window.evidence,
      provenance: {
        schemaVersion: "exposure-event/v0",
        modelVersion: "posture-bucket-classifier/v0",
        calibrationVersion: "none/v0",
        producedAt: new Date().toISOString(),
      },
    };

    await this.events.appendValidated(sessionId, "exposure-event", exposureEvent);
    this.gateway.broadcast(sessionId, "exposure-event", exposureEvent);
    this.logger.debug(`session ${sessionId}: flushed exposure event for bucket ${window.bucket}`);
    return exposureEvent;
  }
}
