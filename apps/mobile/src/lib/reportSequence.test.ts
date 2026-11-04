import type { ClipStats } from "../capture/session-stats";
import { buildReport, easeValue, formatDeg, illustrationAngle, keptFraction, nextIndex, overallCaption, sqiText, tiltNumbers } from "./reportSequence";

const clip = (o: Partial<ClipStats> = {}): ClipStats => ({
  sqi: 80, band: "Good", stars: 3, framesAnalysed: 100, framesKept: 90, framesFiltered: 10, longestSteadySeconds: 5, meanRollDegrees: 1, ...o,
});

describe("buildReport", () => {
  it("handles no stats", () => {
    const r = buildReport([]);
    expect(r.hasAny).toBe(false);
    expect(r.overallSqi).toBeNull();
    expect(r.fullSet).toBe(false);
    expect(r.starsTotal).toBe(0);
    expect(r.starsMax).toBe(12);
    expect(r.rollViews).toHaveLength(0);
    expect(keptFraction(r)).toBeNull();
    expect(overallCaption(r)).toBe("Unavailable");
  });
  it("aggregates a partial set", () => {
    const r = buildReport([["static.anterior", clip({ sqi: 70, stars: 2 })], ["static.posterior", clip({ sqi: 81, stars: 3, longestSteadySeconds: 9.5 })]]);
    expect(r.overallSqi).toBe(76); // 75.5 rounds up
    expect(r.sqiViews).toBe(2);
    expect(r.starsTotal).toBe(5);
    expect(r.framesAnalysed).toBe(200);
    expect(r.framesKept).toBe(180);
    expect(r.framesFiltered).toBe(20);
    expect(r.bestSteadySeconds).toBe(9.5);
    expect(r.fullSet).toBe(false);
    expect(overallCaption(r)).toBe("Mean of 2 of 4 views");
    expect(keptFraction(r)).toBeCloseTo(0.9);
  });
  it("ignores null SQI in the mean and never turns it into 0", () => {
    const r = buildReport([["static.anterior", clip({ sqi: null, band: null, stars: null })], ["static.left_lateral", clip({ sqi: 60, stars: 2 })]]);
    expect(r.views[0]!.sqi).toBeNull();
    expect(r.views[0]!.hasStats).toBe(true);
    expect(r.overallSqi).toBe(60);
    expect(r.sqiViews).toBe(1);
    expect(sqiText(r.views[0]!.sqi)).toBe("Unavailable");
    expect(r.starsTotal).toBe(2);
  });
  it("full set when all four views have stats, even with null SQI", () => {
    const e = ["static.anterior", "static.left_lateral", "static.right_lateral", "static.posterior"].map((k) => [k, clip({ sqi: null, band: null, stars: null })] as const);
    const r = buildReport(e);
    expect(r.fullSet).toBe(true);
    expect(r.overallSqi).toBeNull();
  });
  it("ignores unknown steps and sanitises bad numbers", () => {
    const r = buildReport([["static.other", clip()], ["static.anterior", clip({ framesAnalysed: NaN, meanRollDegrees: NaN, sqi: 140 })]]);
    expect(r.views[0]!.framesAnalysed).toBe(0);
    expect(r.views[0]!.meanRollDegrees).toBeNull();
    expect(r.views[0]!.sqi).toBe(100);
    expect(r.hasAny).toBe(true);
    expect(r.rollViews).toHaveLength(0);
  });
  it("lists views with roll, including zero and negative", () => {
    const r = buildReport([["static.anterior", clip({ meanRollDegrees: 0 })], ["static.left_lateral", clip({ meanRollDegrees: -3.2 })], ["static.right_lateral", clip({ meanRollDegrees: null })]]);
    expect(r.rollViews.map((v) => v.label)).toEqual(["FRONT", "LEFT"]);
  });
});

describe("tilt numbers", () => {
  it("null for missing roll", () => {
    expect(tiltNumbers(null)).toBeNull();
    expect(tiltNumbers(NaN)).toBeNull();
  });
  it("computes sin and cos", () => {
    const t = tiltNumbers(30)!;
    expect(t.sinLabel).toBe("0.500");
    expect(t.cosLabel).toBe("0.866");
    expect(t.thetaLabel).toBe("+30.0°");
    expect(Math.atan2(t.gx, t.gy)).toBeCloseTo(t.radians);
  });
  it("handles negative angles", () => {
    const t = tiltNumbers(-12.34)!;
    expect(t.thetaLabel).toBe("-12.3°");
    expect(t.gx).toBeLessThan(0);
    expect(t.sinLabel.startsWith("-0.2")).toBe(true);
  });
  it("never shows negative zero", () => {
    expect(formatDeg(-0.04)).toBe("0.0°");
    expect(tiltNumbers(-0.0001)!.sinLabel).toBe("0.000");
    expect(tiltNumbers(0)!.cosLabel).toBe("1.000");
  });
  it("rounds to one decimal", () => {
    expect(formatDeg(2.449)).toBe("+2.4°");
    expect(formatDeg(2.46)).toBe("+2.5°");
  });
});

describe("helpers", () => {
  it("illustration is generic atan2", () => {
    const a = illustrationAngle();
    expect(a.dx).toBe(12);
    expect(a.dy).toBe(5);
    expect(a.label).toBe("22.6°");
  });
  it("easeValue clamps", () => {
    expect(easeValue(0, 10, -1)).toBe(0);
    expect(easeValue(0, 10, 2)).toBe(10);
    expect(easeValue(0, 10, 0.5)).toBeGreaterThan(5);
  });
  it("nextIndex loops", () => {
    expect(nextIndex(3, 4)).toBe(0);
    expect(nextIndex(0, 0)).toBe(0);
  });
});
