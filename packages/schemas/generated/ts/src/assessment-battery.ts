/* eslint-disable */
/**
 * Generated from packages/schemas/src/assessment-battery.schema.json - DO NOT EDIT BY HAND.
 * Run `npm run schemas:generate` to regenerate.
 */

/**
 * The ordered capture steps of an assessment, as data, so the app, backend and analysis agree on what each step records and which metrics it can produce. Draft until a clinical lead signs it off.
 */
export interface AssessmentBattery {
  version: string;
  status: "draft" | "approved";
  /**
   * @minItems 1
   */
  steps: [
    {
      stepId: string;
      module: "static" | "functional" | "gait" | "workstation" | "balance";
      title: string;
      /**
       * Shown and spoken to the person being assessed.
       */
      instruction: string;
      view: "anterior" | "posterior" | "left_lateral" | "right_lateral";
      kind: "hold" | "reps" | "passes";
      /**
       * Required when kind=hold.
       */
      durationSeconds?: number;
      /**
       * Required when kind=reps or passes.
       */
      reps?: number;
      minFps: number;
      levelToleranceDegrees?: number;
      /**
       * @minItems 1
       */
      modes: ["clinic" | "patient", ...("clinic" | "patient")[]];
      metricKeys: string[];
      /**
       * True when a member of staff must be within arm's reach for the whole step (HZ-09, induced fall). This is NOT advisory: a step with this set cannot reach recording until a clinician has confirmed presence, and the server refuses a clip for such a step with no confirmation recorded for that session and step. See docs/hazard-analysis.md HZ-09, whose own bar is that a control is structurally enforced rather than documented.
       */
      requiresSpotter?: boolean;
      /**
       * True when the person is asked to close their eyes. Removes visual balance correction, so it raises fall risk independently of stance and is the main reason a step would set requiresSpotter.
       */
      eyesClosed?: boolean;
      /**
       * Base of support. single_left means standing on the person's LEFT leg. Named per side rather than as a generic 'single_leg' because the two are different measurements and a report that pooled them would be comparing different limbs.
       */
      stance?: "bilateral" | "single_left" | "single_right";
      /**
       * Clinician-authored conditions under which this step must not be offered. Same shape as protocol-definition.schema.json's field of the same name, deliberately: a clinician writing one should not have to learn two formats. Free text because the authority is the clinician, not an enum this repo maintains.
       */
      contraindications?: string[];
      /**
       * Clinician-authored plain-language stop/escalate instructions surfaced on a SymptomReport, mirroring protocol-definition.schema.json. These do NOT gate anything on their own: every symptom report reaches Pause regardless of what any rule says (CLAUDE.md rule 2), and these are what a clinician reads afterwards.
       */
      symptomStopRules?: string[];
    },
    ...{
      stepId: string;
      module: "static" | "functional" | "gait" | "workstation" | "balance";
      title: string;
      /**
       * Shown and spoken to the person being assessed.
       */
      instruction: string;
      view: "anterior" | "posterior" | "left_lateral" | "right_lateral";
      kind: "hold" | "reps" | "passes";
      /**
       * Required when kind=hold.
       */
      durationSeconds?: number;
      /**
       * Required when kind=reps or passes.
       */
      reps?: number;
      minFps: number;
      levelToleranceDegrees?: number;
      /**
       * @minItems 1
       */
      modes: ["clinic" | "patient", ...("clinic" | "patient")[]];
      metricKeys: string[];
      /**
       * True when a member of staff must be within arm's reach for the whole step (HZ-09, induced fall). This is NOT advisory: a step with this set cannot reach recording until a clinician has confirmed presence, and the server refuses a clip for such a step with no confirmation recorded for that session and step. See docs/hazard-analysis.md HZ-09, whose own bar is that a control is structurally enforced rather than documented.
       */
      requiresSpotter?: boolean;
      /**
       * True when the person is asked to close their eyes. Removes visual balance correction, so it raises fall risk independently of stance and is the main reason a step would set requiresSpotter.
       */
      eyesClosed?: boolean;
      /**
       * Base of support. single_left means standing on the person's LEFT leg. Named per side rather than as a generic 'single_leg' because the two are different measurements and a report that pooled them would be comparing different limbs.
       */
      stance?: "bilateral" | "single_left" | "single_right";
      /**
       * Clinician-authored conditions under which this step must not be offered. Same shape as protocol-definition.schema.json's field of the same name, deliberately: a clinician writing one should not have to learn two formats. Free text because the authority is the clinician, not an enum this repo maintains.
       */
      contraindications?: string[];
      /**
       * Clinician-authored plain-language stop/escalate instructions surfaced on a SymptomReport, mirroring protocol-definition.schema.json. These do NOT gate anything on their own: every symptom report reaches Pause regardless of what any rule says (CLAUDE.md rule 2), and these are what a clinician reads afterwards.
       */
      symptomStopRules?: string[];
    }[]
  ];
}
