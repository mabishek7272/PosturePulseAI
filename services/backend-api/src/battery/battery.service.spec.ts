import { mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BatteryController } from "./battery.controller";
import { BatteryService, DEFAULT_REFERENCES_DIR } from "./battery.service";

function tempReferences(battery: unknown, reference?: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "refs-"));
  writeFileSync(path.join(dir, "assessment-battery.v0-draft.json"), JSON.stringify(battery));
  if (reference === undefined) {
    copyFileSync(
      path.join(DEFAULT_REFERENCES_DIR, "posture-reference.v0-draft.json"),
      path.join(dir, "posture-reference.v0-draft.json")
    );
  } else {
    writeFileSync(path.join(dir, "posture-reference.v0-draft.json"), JSON.stringify(reference));
  }
  return dir;
}

describe("BatteryService", () => {
  it("loads and validates the checked-in battery and reference set", () => {
    const service = new BatteryService();
    expect(service.battery.version).toBe("assessment-battery/v0-draft");
    expect(service.battery.steps.map((s) => s.stepId)).toEqual([
      "static.anterior",
      "static.left_lateral",
      "static.right_lateral",
      "static.posterior",
    ]);
    expect(service.referenceSet.version).toBe("posture-reference/v0-draft");
  });

  it("looks up a step by id and returns undefined for an unknown one", () => {
    const service = new BatteryService();
    expect(service.step("static.posterior")?.view).toBe("posterior");
    expect(service.step("static.nope")).toBeUndefined();
  });

  it("refuses to start with a battery that does not match its schema", () => {
    const dir = tempReferences({ version: "x", status: "draft", steps: [] });
    expect(() => new BatteryService(dir)).toThrow(/assessment-battery/);
  });

  it("refuses to start with a reference set that does not match its schema", () => {
    const service = new BatteryService();
    const dir = tempReferences(service.battery, { version: "x", status: "draft", reviewedBy: "someone", entries: [] });
    expect(() => new BatteryService(dir)).toThrow(/reference-range-set/);
  });

  it("refuses to start when a step is listed twice", () => {
    const service = new BatteryService();
    const steps = [service.battery.steps[0], service.battery.steps[0]];
    const dir = tempReferences({ ...service.battery, steps });
    expect(() => new BatteryService(dir)).toThrow(/duplicate stepId/);
  });
});

describe("GET /assessment-battery", () => {
  it("returns the battery JSON as loaded", () => {
    const service = new BatteryService();
    expect(new BatteryController(service).get()).toBe(service.battery);
  });
});
