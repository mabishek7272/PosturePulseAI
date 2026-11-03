import type { MetricResult } from "../api/events";
import {
  barLayout, coverage, formatResult, formatValueParts, heroSummary, metricLabel, positionBucket,
  positionLabel, referenceCaption, regionItems, resultKind, ringFraction,
} from "./results";

const est = (extra: Partial<MetricResult> = {}): MetricResult => ({
  metricKey: "static.shoulder_line_tilt", unit: "deg", estimate: { value: 1.8, uncertainty: 0.6 }, ...extra,
});
const unsupported: MetricResult = { metricKey: "static.a", unsupported: { reasons: ["low_confidence", "out_of_frame"] } };
const notMeasurable: MetricResult = { metricKey: "static.b", notMeasurable: { reason: "needs a force plate" } };

describe("formatResult (semantics unchanged)", () => {
  it("formats an estimate with sign, uncertainty and unit", () => {
    expect(formatResult(est())).toBe("+1.8 ± 0.6°");
    expect(formatResult(est({ estimate: { value: -2.04, uncertainty: 0.5 }, unit: "cm" }))).toBe("-2.0 ± 0.5 cm");
  });
  it("keeps unsupported and not-measurable explicit, never numeric", () => {
    expect(formatResult(unsupported)).toBe("Not measured — low_confidence, out_of_frame");
    expect(formatResult(notMeasurable)).toBe("Not measurable — needs a force plate");
    expect(formatResult({ metricKey: "x" })).toBe("No result recorded");
    expect(formatResult(unsupported)).not.toMatch(/\d/);
  });
  it("classifies kinds", () => {
    expect([est(), unsupported, notMeasurable, { metricKey: "x" }].map(resultKind))
      .toEqual(["estimate", "unsupported", "notMeasurable", "none"]);
  });
});

describe("labels and values", () => {
  it("humanises keys", () => {
    expect(metricLabel({ metricKey: "static.shoulder_line_tilt" })).toBe("Shoulder line tilt");
    expect(metricLabel({ metricKey: "gait.step-width", side: "left" })).toBe("Step width (left)");
  });
  it("splits value and uncertainty; null without an estimate", () => {
    expect(formatValueParts(est())).toEqual({ value: "+1.8°", uncertainty: "±0.6" });
    expect(formatValueParts(unsupported)).toBeNull();
  });
});

describe("position", () => {
  it("buckets and words", () => {
    expect(positionBucket(est({ position: "within" }))).toBe("within");
    expect(positionBucket(est({ position: "above" }))).toBe("outside");
    expect(positionBucket(est({ position: "indeterminate" }))).toBe("unknown");
    expect(positionBucket(est())).toBe("unknown");
    expect(positionBucket({ ...unsupported, position: "above" })).toBe("unknown");
    expect(positionLabel(est({ position: "below" }))).toBe("Below the reference");
    expect(positionLabel(est())).toBe("No reference set");
  });
});

describe("coverage and hero", () => {
  const all = [est({ position: "within" }), est({ position: "above" }), unsupported, notMeasurable];
  it("counts facts, not a score", () => {
    expect(coverage(all)).toEqual({ total: 4, measured: 2, unmeasured: 2, outside: 1, within: 1, withReference: 2 });
    expect(ringFraction(coverage(all))).toBe(0.5);
    expect(ringFraction(coverage([]))).toBe(0);
  });
  it("summarises", () => {
    expect(heroSummary(coverage(all))).toEqual({ title: "2 of 4 measured", sub: "1 outside reference · 2 not measured" });
    expect(heroSummary(coverage([est()]))).toEqual({ title: "1 of 1 measured", sub: "No reference data" });
    expect(heroSummary(coverage([])).title).toBe("No metrics returned");
  });
});

describe("regionItems", () => {
  it("lists measured metrics only, capped, with remainder", () => {
    const rs = [est(), unsupported, est({ side: "left" }), est(), est(), est(), est()];
    const { items, more } = regionItems(rs, 4);
    expect(items).toHaveLength(4);
    expect(items[0].text).toBe("Shoulder line tilt — +1.8°");
    expect(more).toBe(2);
  });
});

describe("barLayout", () => {
  it("is null without a reference or estimate (empty track)", () => {
    expect(barLayout(est())).toBeNull();
    expect(barLayout({ ...unsupported, reference: { label: "0", value: 0 } })).toBeNull();
    expect(barLayout(est({ reference: { label: "x" } }))).toBeNull();
  });
  it("maps a range reference into 0..1", () => {
    const l = barLayout(est({ estimate: { value: 7, uncertainty: 1 }, reference: { label: "0–5°", min: 0, max: 5 } }))!;
    expect(l.band.from).toBeLessThan(l.band.to);
    expect(l.fill).toBeGreaterThan(l.band.to);
    for (const n of [l.fill, l.band.from, l.band.to]) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(1); }
  });
  it("gives a single-value reference a thin band", () => {
    const l = barLayout(est({ reference: { label: "0", value: 0 } }))!;
    expect(l.band.to - l.band.from).toBeGreaterThanOrEqual(0.02);
  });
  it("captions", () => {
    expect(referenceCaption(est())).toBe("No reference available");
    expect(referenceCaption(est({ reference: { label: "0–5°", min: 0, max: 5 } }))).toBe("Reference 0–5°");
  });
});
