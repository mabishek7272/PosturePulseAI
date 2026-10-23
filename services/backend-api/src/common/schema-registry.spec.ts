import battery from "../../../../references/assessment-battery.v0-draft.json";
import referenceSet from "../../../../references/posture-reference.v0-draft.json";
import { getValidator, schemaVersionId } from "./schema-registry";

const provenance = {
  schemaVersion: "metric-result/v0",
  modelVersion: "mediapipe-pose-full/0.10.14",
  calibrationVersion: "none/v0",
  producedAt: "2026-10-23T10:00:00Z",
  metricsVersion: "metrics/v1",
};

describe("schema registry (M1 contracts)", () => {
  it.each(["clip-capture", "metric-result", "reference-range-set", "assessment-battery", "assessment-report"] as const)(
    "registers %s with its version id",
    (name) => {
      expect(() => getValidator(name)).not.toThrow();
      expect(schemaVersionId(name)).toBe(`${name}/v0`);
    }
  );

  it("validates the checked-in battery and reference files", () => {
    expect(getValidator("assessment-battery")(battery)).toBe(true);
    expect(getValidator("reference-range-set")(referenceSet)).toBe(true);
  });

  it("resolves the quality-gate reason enum inside metric-result", () => {
    const validate = getValidator("metric-result");
    const base = {
      resultId: "r1",
      sessionId: "s1",
      metricKey: "static.shoulder_line_tilt",
      module: "static",
      tier: "proxy",
      unit: "deg",
      side: null,
      provenance,
    };
    expect(validate({ ...base, unsupported: { reasons: ["camera_not_level"] } })).toBe(true);
    expect(validate({ ...base, unsupported: { reasons: ["made_up_reason"] } })).toBe(false);
  });

  it("keeps quality-gate-flag compilable after it is used as a referenced schema", () => {
    expect(() => getValidator("quality-gate-flag")).not.toThrow();
  });
});
