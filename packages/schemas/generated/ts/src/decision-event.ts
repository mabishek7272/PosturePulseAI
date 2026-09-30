/* eslint-disable */
/**
 * Generated from packages/schemas/src/decision-event.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * Deterministic safety-gate output: evidence + rule + action + version + expiry (TRD 2.2/2.5). Safety rules outrank AI/ML scores; this record is produced AFTER the ML stage, never generated ad hoc by a model prompt.
 */
export interface DecisionEvent {
  decisionEventId: string;
  sessionId: string;
  evaluatedAt: string;
  /**
   * References to the specific records that justified this decision - never an unreferenced/unauditable decision.
   *
   * @minItems 1
   */
  evidence: [
    {
      type:
        | "pose-landmark-frame"
        | "calibrated-joint-frame"
        | "quality-gate-flag"
        | "symptom-report"
        | "camera-pose"
        | "movement-phase-event"
        | "exposure-event"
        | "object-detection-frame"
        | "scale-calibration-record"
        | "sensor-reading";
      refId: string;
      summary?: string;
    },
    ...{
      type:
        | "pose-landmark-frame"
        | "calibrated-joint-frame"
        | "quality-gate-flag"
        | "symptom-report"
        | "camera-pose"
        | "movement-phase-event"
        | "exposure-event"
        | "object-detection-frame"
        | "scale-calibration-record"
        | "sensor-reading";
      refId: string;
      summary?: string;
    }[]
  ];
  rule: {
    ruleId: string;
    ruleVersion: string;
    description: string;
  };
  action: "cue" | "stop" | "pause" | "measurement_unavailable" | "no_action" | "escalate_review";
  /**
   * Populated only when action=cue.
   */
  cuePayload?: {
    cueId: string;
    text: string;
    modality?: ("visual" | "audio" | "haptic")[];
  } | null;
  /**
   * Decision-engine/policy version that produced this event.
   */
  version: string;
  /**
   * Time after which this event is stale and must not be displayed or acted on.
   */
  expiry: string;
}
