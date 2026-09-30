/* eslint-disable */
/**
 * Generated from packages/schemas/src/protocol-definition.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * A clinician-authored exercise protocol as DATA, not code. Every protocol in this repository starts as status=draft/clinicallyValidated=false until a clinical lead signs off (PRD 1.1/4.6).
 */
export interface ProtocolDefinition {
  protocolId: string;
  version: string;
  name: string;
  status: "draft" | "clinically-reviewed";
  clinicallyValidated: boolean;
  reviewedBy: string | null;
  targetPopulation: string;
  /**
   * @minItems 1
   */
  deploymentContext: ["clinic_supervised" | "home_rehab", ...("clinic_supervised" | "home_rehab")[]];
  /**
   * @minItems 1
   */
  exercises: [
    {
      exerciseId: string;
      name: string;
      /**
       * Free-text movement-phase label used by ml-service phase detection, e.g. 'descend', 'hold', 'ascend'.
       */
      phase: string;
      repRange: {
        min: number;
        max: number;
      };
      /**
       * Allowed deviation before a cue becomes eligible; clinician-set, not a universal threshold.
       */
      toleranceDegrees: number;
      restSeconds: number;
      /**
       * Clinician-authored expected angle per joint for this exercise phase. toleranceDegrees is the allowed deviation FROM this target. Optional: an exercise without this field cannot drive a deviation-based cue - the policy engine falls back to no_action for it, never fabricating a target (see docs/adr/005-deterministic-policy-engine.md).
       */
      targetJointAngles?: {
        jointName: string;
        targetDegrees: number;
      }[];
    },
    ...{
      exerciseId: string;
      name: string;
      /**
       * Free-text movement-phase label used by ml-service phase detection, e.g. 'descend', 'hold', 'ascend'.
       */
      phase: string;
      repRange: {
        min: number;
        max: number;
      };
      /**
       * Allowed deviation before a cue becomes eligible; clinician-set, not a universal threshold.
       */
      toleranceDegrees: number;
      restSeconds: number;
      /**
       * Clinician-authored expected angle per joint for this exercise phase. toleranceDegrees is the allowed deviation FROM this target. Optional: an exercise without this field cannot drive a deviation-based cue - the policy engine falls back to no_action for it, never fabricating a target (see docs/adr/005-deterministic-policy-engine.md).
       */
      targetJointAngles?: {
        jointName: string;
        targetDegrees: number;
      }[];
    }[]
  ];
  contraindications: string[];
  /**
   * Clinician-authored plain-language stop/escalate instructions surfaced on a SymptomReport.
   */
  symptomStopRules: string[];
  createdAt: string;
}
