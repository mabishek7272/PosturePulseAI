import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { EventsService } from "../events/events.service";
import { ExposureAggregatorService } from "../exposure/exposure-aggregator.service";
import { MovementWindowBufferService } from "../movement/movement-window-buffer.service";
import { PolicyEngineService } from "../policy/policy-engine.service";
import { SessionGateway } from "../ws/session.gateway";
import type { MlFrameResult } from "./ml-client.service";

interface QualityGateFlagShape {
  flagId: string;
  state: "supported" | "unsupported";
}

interface CalibratedJointFrameShape {
  jointFrameId: string;
  capturedAt: string;
  angles: unknown[];
}

/**
 * Consumes ml-service's per-frame result: validates against the canonical
 * schemas, persists+broadcasts the raw records, then delegates the actual
 * safety/cue decision to PolicyEngineService - this class is a thin
 * dispatcher and never builds a DecisionEvent itself (see
 * docs/adr/005-deterministic-policy-engine.md).
 */
@Injectable()
export class MlResultConsumer {
  constructor(
    private readonly events: EventsService,
    private readonly gateway: SessionGateway,
    private readonly policyEngine: PolicyEngineService,
    private readonly exposureAggregator: ExposureAggregatorService,
    private readonly movementWindowBuffer: MovementWindowBufferService,
    private readonly prisma: PrismaService
  ) {}

  async handleFrame(sessionId: string, result: MlFrameResult) {
    await this.events.appendValidated(sessionId, "pose-landmark-frame", result.poseLandmarkFrame);
    await this.events.appendValidated(sessionId, "quality-gate-flag", result.qualityGateFlag);
    this.gateway.broadcast(sessionId, "pose-landmark-frame", result.poseLandmarkFrame);
    this.gateway.broadcast(sessionId, "quality-gate-flag", result.qualityGateFlag);

    if (result.calibratedJointFrame) {
      await this.events.appendValidated(sessionId, "calibrated-joint-frame", result.calibratedJointFrame);
      this.gateway.broadcast(sessionId, "calibrated-joint-frame", result.calibratedJointFrame);
    }

    const qualityGateFlag = result.qualityGateFlag as QualityGateFlagShape;
    const calibratedJointFrame = result.calibratedJointFrame as CalibratedJointFrameShape | null;
    await this.exposureAggregator.recordFrame(
      sessionId,
      result.postureBucketHint,
      qualityGateFlag.state === "supported",
      new Date(),
      calibratedJointFrame
        ? { type: "calibrated-joint-frame", refId: calibratedJointFrame.jointFrameId }
        : { type: "quality-gate-flag", refId: qualityGateFlag.flagId }
    );

    if (calibratedJointFrame) {
      const exerciseId = await this.resolveActiveExerciseId(sessionId);
      if (exerciseId) {
        // Descriptive-only orchestration, structurally isolated from the
        // safety path - MovementWindowBufferService has no dependency on
        // SafetyService at all (see its own doc comment). Awaited here only
        // for deterministic ordering/testability; it catches its own errors
        // internally and never throws into this method.
        await this.movementWindowBuffer.addFrame(sessionId, exerciseId, calibratedJointFrame);
      }
    }

    return this.policyEngine.evaluateFrame(
      sessionId,
      result.qualityGateFlag as Parameters<PolicyEngineService["evaluateFrame"]>[1],
      result.calibratedJointFrame as Parameters<PolicyEngineService["evaluateFrame"]>[2]
    );
  }

  private async resolveActiveExerciseId(sessionId: string): Promise<string | null> {
    const session = await this.prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    const protocolVersion = await this.prisma.protocolVersion.findUnique({
      where: { protocolKey_version: { protocolKey: session.protocolId, version: session.protocolVersion } },
    });
    const definition = protocolVersion?.definition as { exercises?: Array<{ exerciseId: string }> } | undefined;
    // Same Phase 3 scaffolding simplification as PolicyEngineService: single
    // active exercise per session, the first one in the protocol.
    return definition?.exercises?.[0]?.exerciseId ?? null;
  }
}
