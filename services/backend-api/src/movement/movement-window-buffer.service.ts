import { Injectable, Logger } from "@nestjs/common";
import { EventsService } from "../events/events.service";
import { MlClientService } from "../ml-integration/ml-client.service";
import { SessionGateway } from "../ws/session.gateway";

interface AngleFrame {
  jointFrameId: string;
  capturedAt: string;
  angles: unknown[];
}

interface WindowBuffer {
  exerciseId: string;
  frames: AngleFrame[];
  windowStartAt: string;
}

// Placeholder window length - not clinically derived. Non-overlapping windows
// in this phase (simplest correct behavior; overlapping/sliding windows are a
// future refinement, not attempted here).
const WINDOW_SIZE_FRAMES = 16;

/**
 * ST-GCN/TCN orchestration only - descriptive/exposure analytics, never a
 * safety decision (docs/adr/005-deterministic-policy-engine.md). This class
 * deliberately does NOT depend on SafetyService: there is no import of it
 * anywhere in this file, which makes "movement output cannot gate the safety
 * FSM" a structural fact, not a convention someone could accidentally break.
 */
@Injectable()
export class MovementWindowBufferService {
  private readonly logger = new Logger(MovementWindowBufferService.name);
  private readonly buffers = new Map<string, WindowBuffer>();

  constructor(
    private readonly mlClient: MlClientService,
    private readonly events: EventsService,
    private readonly gateway: SessionGateway
  ) {}

  async addFrame(
    sessionId: string,
    exerciseId: string,
    calibratedJointFrame: { jointFrameId: string; capturedAt: string; angles: unknown[] }
  ): Promise<void> {
    const key = `${sessionId}:${exerciseId}`;
    const buffer = this.buffers.get(key) ?? {
      exerciseId,
      frames: [],
      windowStartAt: calibratedJointFrame.capturedAt,
    };
    buffer.frames.push({
      jointFrameId: calibratedJointFrame.jointFrameId,
      capturedAt: calibratedJointFrame.capturedAt,
      angles: calibratedJointFrame.angles,
    });
    this.buffers.set(key, buffer);

    if (buffer.frames.length < WINDOW_SIZE_FRAMES) return;

    const windowEndAt = buffer.frames[buffer.frames.length - 1].capturedAt;
    try {
      const record = await this.mlClient.sendMovementWindow({
        sessionId,
        exerciseId,
        windowStartAt: buffer.windowStartAt,
        windowEndAt,
        jointAngleSequence: buffer.frames.map((f) => f.angles),
        sourceFrameIds: buffer.frames.map((f) => f.jointFrameId),
      });
      await this.events.appendValidated(sessionId, "movement-phase-event", record);
      this.gateway.broadcast(sessionId, "movement-phase-event", record);
    } catch (error) {
      // Descriptive-only output - a failure here must never propagate into
      // the safety/policy path. Log and drop the window.
      this.logger.warn(`session ${sessionId}: movement-window call failed, dropping window: ${error}`);
    }

    this.buffers.delete(key);
  }
}
