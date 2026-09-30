import { Injectable } from "@nestjs/common";

interface RepState {
  direction: "unknown" | "ascending" | "descending";
  lastAngleDegrees: number | null;
  repCount: number;
}

// Placeholder noise floor - not clinically derived. A frame-to-frame angle
// change smaller than this is treated as jitter, not a direction change.
const DIRECTION_CHANGE_THRESHOLD_DEGREES = 3;

/**
 * Deterministic direction-reversal rep counter over a single tracked joint's
 * angle series (docs/adr/005-deterministic-policy-engine.md - no ST-GCN/TCN
 * involved). Counts one rep each time the joint transitions from descending
 * to ascending (the bottom of a movement, e.g. lowest point of a squat).
 */
@Injectable()
export class RepCounterService {
  private readonly state = new Map<string, RepState>();

  update(
    sessionId: string,
    exerciseId: string,
    jointName: string,
    angles: Array<{ jointName: string; thetaRadians: number }>
  ): number {
    const key = `${sessionId}:${exerciseId}`;
    const observed = angles.find((a) => a.jointName === jointName);
    if (!observed) return this.getCount(sessionId, exerciseId);

    const angleDegrees = (observed.thetaRadians * 180) / Math.PI;
    const current: RepState = this.state.get(key) ?? { direction: "unknown", lastAngleDegrees: null, repCount: 0 };

    if (current.lastAngleDegrees !== null) {
      const delta = angleDegrees - current.lastAngleDegrees;
      if (Math.abs(delta) >= DIRECTION_CHANGE_THRESHOLD_DEGREES) {
        const newDirection: RepState["direction"] = delta > 0 ? "ascending" : "descending";
        if (current.direction === "descending" && newDirection === "ascending") {
          current.repCount += 1;
        }
        current.direction = newDirection;
      }
    }
    current.lastAngleDegrees = angleDegrees;
    this.state.set(key, current);
    return current.repCount;
  }

  getCount(sessionId: string, exerciseId: string): number {
    return this.state.get(`${sessionId}:${exerciseId}`)?.repCount ?? 0;
  }

  reset(sessionId: string, exerciseId: string) {
    this.state.delete(`${sessionId}:${exerciseId}`);
  }
}
