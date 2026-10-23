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
      module: "static" | "functional" | "gait" | "workstation";
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
    },
    ...{
      stepId: string;
      module: "static" | "functional" | "gait" | "workstation";
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
    }[]
  ];
}
