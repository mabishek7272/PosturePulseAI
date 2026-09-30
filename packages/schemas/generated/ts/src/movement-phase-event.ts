/* eslint-disable */
/**
 * Generated from packages/schemas/src/movement-phase-event.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * ST-GCN/TCN phase/rep-segmentation output (TRD 2.2). validated is hard-constrained to false in this phase - no held-out evaluation exists (that is Phase 4 territory). Descriptive/exposure use only; NEVER cited as evidence for a safety-relevant DecisionEvent.action (cue/escalate_review) - see docs/adr/005-deterministic-policy-engine.md. Model weights producing this record are randomly initialized/untrained; predictedPhase/phaseConfidence carry no statistical meaning yet.
 */
export interface MovementPhaseEvent {
  movementPhaseEventId: string;
  sessionId: string;
  exerciseId: string;
  windowStartAt: string;
  windowEndAt: string;
  modelArchitecture: "tcn" | "st-gcn";
  /**
   * Hard-coded false in this phase - true is not schema-valid until a real held-out clinical evaluation exists.
   */
  validated: false;
  predictedPhase: string | null;
  phaseConfidence: number;
  repCountDelta: number;
  /**
   * @minItems 1
   */
  evidence: [
    {
      type: "calibrated-joint-frame";
      refId: string;
    },
    ...{
      type: "calibrated-joint-frame";
      refId: string;
    }[]
  ];
  /**
   * Per-record provenance so every event self-reports the versions that produced it (TRD traceability requirement).
   */
  provenance: {
    /**
     * Version of this record's own JSON Schema, e.g. "pose-landmark-frame/v0".
     */
    schemaVersion: string;
    /**
     * Identifier+version of the model/adapter that produced this record, e.g. "mediapipe-pose/0.10.9".
     */
    modelVersion: string;
    adapterVersion?: string;
    /**
     * Identifier of the camera calibration record in effect when this record was produced.
     */
    calibrationVersion: string;
    producedAt: string;
  };
}
