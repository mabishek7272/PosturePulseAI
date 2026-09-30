import { Injectable, Logger } from "@nestjs/common";
import { v4 as uuid } from "uuid";
import { PrismaService } from "../common/prisma.service";
import { EventsService } from "../events/events.service";
import { SafetyService } from "../safety/safety.service";
import { SessionGateway } from "../ws/session.gateway";
import { DeviationDetectorService } from "./deviation-detector.service";
import { RepCounterService } from "./rep-counter.service";

interface QualityGateFlagShape {
  flagId: string;
  state: "supported" | "unsupported";
  reasons: string[];
}

interface AngleShape {
  jointName: string;
  thetaRadians: number;
}

interface CalibratedJointFrameShape {
  jointFrameId: string;
  angles: AngleShape[];
}

interface TargetJointAngle {
  jointName: string;
  targetDegrees: number;
}

interface ExerciseDefinition {
  exerciseId: string;
  toleranceDegrees: number;
  repRange?: { min: number; max: number };
  targetJointAngles?: TargetJointAngle[];
}

/**
 * The single place a DecisionEvent is ever produced (moved out of
 * ml-result.consumer.ts). Precedence order, most safety-critical first:
 *   1. unsupported quality -> measurement_unavailable (never suppressed)
 *   2. sustained deviation -> cue
 *   3. rep overflow -> escalate_review
 *   4. otherwise -> no DecisionEvent
 *
 * ST-GCN/TCN output (movement/ module) NEVER reaches this service - see
 * docs/adr/005-deterministic-policy-engine.md. Only a deterministic
 * angle/target/tolerance/rep-range comparison drives a safety-relevant
 * decision.
 *
 * Rep overflow is deliberately NOT routed through the safety state machine:
 * ClinicianReview in safety-state-machine.ts is reserved for symptom/
 * contraindication escalation (the only path into it is Pause ->
 * ESCALATION_RULE). A rep-count anomaly is a clinician-review DATA flag, not
 * a safety-FSM event - the session continues in whatever state it was in.
 */
@Injectable()
export class PolicyEngineService {
  private readonly logger = new Logger(PolicyEngineService.name);

  constructor(
    private readonly events: EventsService,
    private readonly safety: SafetyService,
    private readonly gateway: SessionGateway,
    private readonly prisma: PrismaService,
    private readonly deviationDetector: DeviationDetectorService,
    private readonly repCounter: RepCounterService
  ) {}

  async evaluateFrame(
    sessionId: string,
    qualityGateFlag: QualityGateFlagShape,
    calibratedJointFrame: CalibratedJointFrameShape | null
  ): Promise<{ decisionEvent: unknown | null; safetyState: string }> {
    if (qualityGateFlag.state === "unsupported") {
      return this.handleUnsupportedQuality(sessionId, qualityGateFlag);
    }

    if (!calibratedJointFrame || calibratedJointFrame.angles.length === 0) {
      // Supported quality but nothing computable this frame - no fabricated action.
      return { decisionEvent: null, safetyState: await this.safety.getState(sessionId) };
    }

    const exercise = await this.resolveActiveExercise(sessionId);
    if (!exercise) {
      return { decisionEvent: null, safetyState: await this.safety.getState(sessionId) };
    }

    const deviationOutcome = await this.handleDeviation(sessionId, exercise, calibratedJointFrame);
    if (deviationOutcome) return deviationOutcome;

    const repOutcome = await this.handleRepOverflow(sessionId, exercise, calibratedJointFrame);
    if (repOutcome) return repOutcome;

    return { decisionEvent: null, safetyState: await this.safety.getState(sessionId) };
  }

  private async handleUnsupportedQuality(sessionId: string, qualityGateFlag: QualityGateFlagShape) {
    const decisionEvent = this.buildDecisionEvent(sessionId, {
      evidence: [{ type: "quality-gate-flag", refId: qualityGateFlag.flagId, summary: qualityGateFlag.reasons.join(",") }],
      rule: { ruleId: "HZ-03", ruleVersion: "v0", description: "Quality gate reported unsupported - suppress any corrective cue." },
      action: "measurement_unavailable",
      cuePayload: null,
    });
    await this.persistAndBroadcast(sessionId, decisionEvent);

    const safetyState = await this.safety.send(sessionId, {
      type: "QUALITY_LOST",
      reason: qualityGateFlag.reasons[0] ?? "unsupported",
    });
    this.gateway.broadcast(sessionId, "state", { state: safetyState });
    return { decisionEvent, safetyState };
  }

  private async handleDeviation(
    sessionId: string,
    exercise: ExerciseDefinition,
    calibratedJointFrame: CalibratedJointFrameShape
  ) {
    const deviation = this.deviationDetector.evaluate(
      sessionId,
      exercise.exerciseId,
      calibratedJointFrame.angles,
      exercise.targetJointAngles,
      exercise.toleranceDegrees
    );
    if (!deviation.sustained) return null;

    const stateAfterDeviation = await this.safety.send(sessionId, { type: "SUSTAINED_DEVIATION" });
    if (stateAfterDeviation !== "CueEligible") {
      // A concurrent safety signal (e.g. a symptom report) won the race and
      // the FSM is now in Pause/Unavailable - safety wins, no cue is built.
      this.logger.debug(`session ${sessionId}: deviation sustained but FSM is ${stateAfterDeviation}, not CueEligible - no cue`);
      return { decisionEvent: null, safetyState: stateAfterDeviation };
    }

    const cueId = uuid();
    const decisionEvent = this.buildDecisionEvent(sessionId, {
      evidence: [
        {
          type: "calibrated-joint-frame",
          refId: calibratedJointFrame.jointFrameId,
          summary: `${deviation.jointName} deviated ${deviation.deviationDegrees?.toFixed(1)} degrees beyond tolerance`,
        },
      ],
      rule: {
        ruleId: "HZ-05",
        ruleVersion: "v0",
        description: `Sustained deviation on ${deviation.jointName} beyond the clinician-set tolerance.`,
      },
      action: "cue",
      cuePayload: { cueId, text: `Adjust your ${deviation.jointName} position`, modality: ["visual"] },
    });
    await this.persistAndBroadcast(sessionId, decisionEvent);

    const stateAfterCue = await this.safety.send(sessionId, { type: "CUE_DELIVERED" });
    this.gateway.broadcast(sessionId, "state", { state: stateAfterCue });
    return { decisionEvent, safetyState: stateAfterCue };
  }

  private async handleRepOverflow(
    sessionId: string,
    exercise: ExerciseDefinition,
    calibratedJointFrame: CalibratedJointFrameShape
  ) {
    const primaryJoint = exercise.targetJointAngles?.[0]?.jointName;
    if (!primaryJoint || !exercise.repRange) return null;

    const repCount = this.repCounter.update(sessionId, exercise.exerciseId, primaryJoint, calibratedJointFrame.angles);
    if (repCount <= exercise.repRange.max) return null;

    const decisionEvent = this.buildDecisionEvent(sessionId, {
      evidence: [
        {
          type: "calibrated-joint-frame",
          refId: calibratedJointFrame.jointFrameId,
          summary: `repCount=${repCount} exceeds protocol max=${exercise.repRange.max}`,
        },
      ],
      rule: {
        ruleId: "REP-OVERFLOW",
        ruleVersion: "v0",
        description: "Repetition count exceeded the protocol's max - flagged for clinician review, session not interrupted.",
      },
      action: "escalate_review",
      cuePayload: null,
    });
    await this.persistAndBroadcast(sessionId, decisionEvent);

    // Deliberately no safety.send() here - see class doc comment.
    return { decisionEvent, safetyState: await this.safety.getState(sessionId) };
  }

  private async resolveActiveExercise(sessionId: string): Promise<ExerciseDefinition | null> {
    const session = await this.prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    const protocolVersion = await this.prisma.protocolVersion.findUnique({
      where: { protocolKey_version: { protocolKey: session.protocolId, version: session.protocolVersion } },
    });
    const definition = protocolVersion?.definition as { exercises?: ExerciseDefinition[] } | undefined;
    // Phase 3 scaffolding: single active exercise per session, the first one
    // in the protocol - there is no per-session "current exercise" tracking
    // mechanism yet. A deliberate simplification, not a bug.
    return definition?.exercises?.[0] ?? null;
  }

  private buildDecisionEvent(
    sessionId: string,
    partial: { evidence: unknown[]; rule: unknown; action: string; cuePayload: unknown }
  ) {
    return {
      decisionEventId: uuid(),
      sessionId,
      evaluatedAt: new Date().toISOString(),
      evidence: partial.evidence,
      rule: partial.rule,
      action: partial.action,
      cuePayload: partial.cuePayload,
      version: "policy-v0",
      expiry: new Date(Date.now() + 5000).toISOString(),
    };
  }

  private async persistAndBroadcast(sessionId: string, decisionEvent: unknown) {
    await this.events.appendValidated(sessionId, "decision-event", decisionEvent);
    this.gateway.broadcast(sessionId, "decision-event", decisionEvent);
  }
}
