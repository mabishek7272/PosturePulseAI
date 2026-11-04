import { Injectable } from "@nestjs/common";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getValidator } from "../common/schema-registry";
import type { AssessmentBattery, BatteryStep, ReferenceRangeSet } from "./types";

// references/ lives at the repo root, four levels up from
// services/backend-api/src/battery/ (the Dockerfile copies it to /srv/references).
export const DEFAULT_REFERENCES_DIR = path.resolve(__dirname, "../../../../references");
export const BATTERY_FILE = "assessment-battery.v0-draft.json";
export const REFERENCE_FILE = "posture-reference.v0-draft.json";

function loadValidated<T>(dir: string, file: string, schemaName: "assessment-battery" | "reference-range-set"): T {
  const parsed: unknown = JSON.parse(readFileSync(path.join(dir, file), "utf-8"));
  const validate = getValidator(schemaName);
  if (!validate(parsed)) {
    // Same discipline as protocols/*.json: a data file that fails its own
    // schema blocks boot rather than loading silently.
    throw new Error(`${file} does not conform to ${schemaName}.schema.json: ${JSON.stringify(validate.errors)}`);
  }
  return parsed as T;
}

/**
 * Two rules about `subBlocks` that JSON Schema cannot express, checked at boot
 * so bad protocol data stops the service starting rather than reaching a
 * patient - the same discipline as `loadValidated` above.
 *
 * Both are the kind of mistake that is easy to make by hand and invisible on
 * inspection: a sub-block list whose durations do not add up to the step's own
 * duration leaves the last phase either truncated or running past the end of
 * the recording, and a repeated phase name makes the per-frame `subPhase` tag
 * ambiguous, so the analysis could not tell which block a frame belonged to.
 */
export function assertSubBlocksConsistent(step: BatteryStep): void {
  const blocks = step.subBlocks;
  if (!blocks || blocks.length === 0) return;

  const phases = blocks.map((b) => b.phase);
  const duplicate = phases.find((p, i) => phases.indexOf(p) !== i);
  if (duplicate) {
    throw new Error(
      `${BATTERY_FILE}: step "${step.stepId}" repeats sub-phase "${duplicate}"; ` +
        "each phase may appear at most once, or a frame's subPhase tag is ambiguous."
    );
  }

  const sum = blocks.reduce((total, b) => total + b.durationSeconds, 0);
  if (step.durationSeconds === undefined) {
    throw new Error(`${BATTERY_FILE}: step "${step.stepId}" declares subBlocks but no durationSeconds.`);
  }
  // Tolerance, not equality: these are hand-authored decimals and an exact
  // float comparison would reject 1.1 + 2.2 + 6.7 against 10.
  if (Math.abs(sum - step.durationSeconds) > 1e-6) {
    throw new Error(
      `${BATTERY_FILE}: step "${step.stepId}" sub-block durations sum to ${sum}s ` +
        `but the step declares ${step.durationSeconds}s.`
    );
  }
}

/**
 * The assessment battery and the reference-range set, loaded once and
 * validated at startup. Both are draft data (status "draft") until a clinical
 * lead signs them off - this service never changes their status.
 */
@Injectable()
export class BatteryService {
  readonly battery: AssessmentBattery;
  readonly referenceSet: ReferenceRangeSet;
  private readonly steps: Map<string, BatteryStep>;

  constructor(referencesDir: string = process.env.REFERENCES_DIR ?? DEFAULT_REFERENCES_DIR) {
    this.battery = loadValidated<AssessmentBattery>(referencesDir, BATTERY_FILE, "assessment-battery");
    this.referenceSet = loadValidated<ReferenceRangeSet>(referencesDir, REFERENCE_FILE, "reference-range-set");
    this.steps = new Map();
    for (const step of this.battery.steps) {
      if (this.steps.has(step.stepId)) {
        throw new Error(`${BATTERY_FILE}: duplicate stepId "${step.stepId}"`);
      }
      assertSubBlocksConsistent(step);
      this.steps.set(step.stepId, step);
    }
  }

  step(stepId: string): BatteryStep | undefined {
    return this.steps.get(stepId);
  }
}
