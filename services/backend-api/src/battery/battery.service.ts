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
      this.steps.set(step.stepId, step);
    }
  }

  step(stepId: string): BatteryStep | undefined {
    return this.steps.get(stepId);
  }
}
