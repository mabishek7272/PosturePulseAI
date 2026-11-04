import type { MetricResult } from "../api/events";
import { compareScans, compareValues, formatCompareValue, withinStatement } from "./compare";

const est = (metricKey: string, value: number, uncertainty: number | undefined, extra: Partial<MetricResult> = {}): MetricResult =>
  ({ metricKey, unit: "deg", estimate: { value, uncertainty: uncertainty as number }, ...extra });

describe("compareValues", () => {
  it("computes n=2 mean, sample SD, signed difference", () => {
    const c = compareValues(2, 1, 4, 1);
    expect(c.mean).toBe(3);
    expect(c.deviation).toBeCloseTo(2 / Math.sqrt(2));
    expect(c.difference).toBe(2);
    expect(c.combinedUncertainty).toBeCloseTo(Math.sqrt(2));
    expect(c.withinCombined).toBe(false);
  });
  it("signs the difference as B - A", () => {
    expect(compareValues(4, 1, 1, 1).difference).toBe(-3);
  });
  it("is within when |diff| <= combined uncertainty (boundary)", () => {
    expect(compareValues(0, 3, 5, 4).withinCombined).toBe(true);
    expect(compareValues(0, 1, 1, 1).withinCombined).toBe(true);
  });
  it("identical values", () => {
    const c = compareValues(1.5, 0.5, 1.5, 0.5);
    expect(c.difference).toBe(0);
    expect(c.deviation).toBe(0);
    expect(c.withinCombined).toBe(true);
  });
  it("missing or null uncertainty is not zero", () => {
    expect(compareValues(1, null, 5, 1).withinCombined).toBeNull();
    expect(compareValues(1, undefined, 5, undefined).combinedUncertainty).toBeNull();
    expect(compareValues(1, NaN, 1, 1).withinCombined).toBeNull();
    expect(withinStatement({ withinCombined: null })).toMatch(/not reported/);
  });
});

describe("compareScans", () => {
  it("pairs side-labelled metrics by side", () => {
    const a = [est("static.knee", 1, 1, { side: "left" }), est("static.knee", 9, 1, { side: "right" })];
    const b = [est("static.knee", 2, 1, { side: "left" }), est("static.knee", 8, 1, { side: "right" })];
    const r = compareScans(a, b);
    expect(r.compared.map((c) => [c.label, c.difference])).toEqual([["Knee (left)", 1], ["Knee (right)", -1]]);
  });
  it("lists one-sided unsupported with the reason and no number", () => {
    const a = [est("static.tilt", 3, 1)];
    const b: MetricResult[] = [{ metricKey: "static.tilt", unsupported: { reasons: ["low pose quality"] } }];
    const r = compareScans(a, b);
    expect(r.compared).toHaveLength(0);
    expect(r.notCompared[0]!.reasons).toEqual(["Later scan: Not measured — low pose quality"]);
    expect(JSON.stringify(r.notCompared)).not.toMatch(/3\.0/);
  });
  it("reports notMeasurable and metrics missing from one scan", () => {
    const r = compareScans(
      [{ metricKey: "m.x", notMeasurable: { reason: "occluded" } }],
      [est("m.y", 1, 1)]
    );
    expect(r.notCompared.find((n) => n.key === "m.y|")!.reasons).toEqual(["Earlier scan: not recorded"]);
    expect(r.notCompared.find((n) => n.key === "m.x|")!.reasons).toEqual([
      "Earlier scan: Not measurable — occluded", "Later scan: not recorded",
    ]);
  });
  it("does not compare differing units", () => {
    const r = compareScans([est("m.z", 1, 1)], [est("m.z", 2, 1, { unit: "cm" })]);
    expect(r.compared).toHaveLength(0);
    expect(r.notCompared[0]!.reasons[0]).toMatch(/Units differ/);
  });
  it("formats with the Results conventions (sign, 1 dp, degree)", () => {
    expect(formatCompareValue(2, "deg")).toBe("+2.0°");
    expect(formatCompareValue(-2.04, "deg")).toBe("-2.0°");
    expect(formatCompareValue(3, "cm")).toBe("+3.0 cm");
  });
});
