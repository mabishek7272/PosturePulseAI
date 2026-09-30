import { Injectable } from "@nestjs/common";

interface RollingState {
  consecutiveDeviationCount: number;
  lastJointName?: string;
  lastDeviationDegrees?: number;
}

export interface DeviationResult {
  sustained: boolean;
  jointName?: string;
  deviationDegrees?: number;
}

// Placeholder threshold - not clinically derived. A deviation must persist for
// this many consecutive supported frames before it counts as "sustained",
// which keeps a single noisy frame from firing a cue.
const DEVIATION_SUSTAIN_FRAMES = 5;

/**
 * Deterministic angle-vs-target-vs-tolerance comparison (docs/adr/005-
 * deterministic-policy-engine.md). This, not ST-GCN/TCN, is what drives a
 * real "cue" DecisionEvent - fully explainable, fully testable, no untrained
 * model in the safety path.
 */
@Injectable()
export class DeviationDetectorService {
  private readonly state = new Map<string, RollingState>();

  evaluate(
    sessionId: string,
    exerciseId: string,
    angles: Array<{ jointName: string; thetaRadians: number }>,
    targetJointAngles: Array<{ jointName: string; targetDegrees: number }> | undefined,
    toleranceDegrees: number
  ): DeviationResult {
    const key = `${sessionId}:${exerciseId}`;

    // No clinician-set target - never fabricate one; this exercise simply
    // cannot drive a deviation-based cue (protocol-definition.schema.json's
    // targetJointAngles is optional for exactly this reason).
    if (!targetJointAngles || targetJointAngles.length === 0) {
      this.state.delete(key);
      return { sustained: false };
    }

    let worst: { jointName: string; deviationDegrees: number } | null = null;
    for (const target of targetJointAngles) {
      const observed = angles.find((a) => a.jointName === target.jointName);
      if (!observed) continue;
      const observedDegrees = (observed.thetaRadians * 180) / Math.PI;
      const deviationDegrees = Math.abs(observedDegrees - target.targetDegrees);
      if (deviationDegrees > toleranceDegrees && (!worst || deviationDegrees > worst.deviationDegrees)) {
        worst = { jointName: target.jointName, deviationDegrees };
      }
    }

    const current = this.state.get(key) ?? { consecutiveDeviationCount: 0 };
    if (worst) {
      current.consecutiveDeviationCount += 1;
      current.lastJointName = worst.jointName;
      current.lastDeviationDegrees = worst.deviationDegrees;
    } else {
      current.consecutiveDeviationCount = 0;
    }

    if (current.consecutiveDeviationCount >= DEVIATION_SUSTAIN_FRAMES) {
      const result: DeviationResult = {
        sustained: true,
        jointName: current.lastJointName,
        deviationDegrees: current.lastDeviationDegrees,
      };
      // Reset after firing so the same sustained deviation doesn't re-fire every frame.
      this.state.set(key, { consecutiveDeviationCount: 0 });
      return result;
    }

    this.state.set(key, current);
    return { sustained: false };
  }

  reset(sessionId: string, exerciseId: string) {
    this.state.delete(`${sessionId}:${exerciseId}`);
  }
}
