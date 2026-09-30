/* eslint-disable */
/**
 * Generated from packages/schemas/src/quality-gate-flag.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * First-class 'unsupported' state. When required landmarks, scale, identity, or anchor are insufficient, numeric guidance MUST be suppressed via this record - never silently omitted (PRD 1.6, TRD 2.7).
 */
export interface QualityGateFlag {
  flagId: string;
  sessionId: string;
  frameId: string;
  evaluatedAt: string;
  state: "supported" | "unsupported";
  /**
   * Must be non-empty when state=unsupported; must be empty when state=supported.
   */
  reasons: (
    | "insufficient_landmarks"
    | "insufficient_scale"
    | "identity_uncertain"
    | "anchor_drift"
    | "low_confidence"
    | "occlusion"
  )[];
  /**
   * Names of downstream outputs suppressed by this flag, e.g. 'kneeFlexionAngle', 'decisionEvent.cue'. Empty when state=supported.
   */
  affectedOutputs: string[];
}
