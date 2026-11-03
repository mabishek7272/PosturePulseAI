import { clearSessionStats, getClipStats, getSessionStats, meanRollFromSamples, recordClipStats, type ClipStats } from "./session-stats";

const stats = (sqi: number | null): ClipStats => ({
  sqi, band: sqi === null ? null : "Good", stars: sqi === null ? null : 2,
  framesAnalysed: 100, framesKept: 80, framesFiltered: 20, longestSteadySeconds: 12.5, meanRollDegrees: 0.4,
});

describe("session stats store", () => {
  beforeEach(() => clearSessionStats());
  it("keys by session and step", () => {
    recordClipStats("s1", "static.anterior", stats(70));
    recordClipStats("s1", "static.posterior", stats(null));
    recordClipStats("s2", "static.anterior", stats(90));
    expect(getClipStats("s1", "static.anterior")?.sqi).toBe(70);
    expect(getClipStats("s1", "static.posterior")?.sqi).toBeNull();
    expect(getClipStats("s2", "static.anterior")?.sqi).toBe(90);
    expect(getClipStats("s1", "nope")).toBeUndefined();
    expect(getSessionStats("s1").map(([k]) => k)).toEqual(["static.anterior", "static.posterior"]);
    expect(getSessionStats("zzz")).toEqual([]);
  });
  it("overwrites on re-record and returns copies", () => {
    recordClipStats("s1", "a", stats(50));
    recordClipStats("s1", "a", stats(60));
    const got = getClipStats("s1", "a")!;
    got.sqi = 1;
    expect(getClipStats("s1", "a")?.sqi).toBe(60);
  });
  it("clears one session or all", () => {
    recordClipStats("s1", "a", stats(1));
    recordClipStats("s2", "a", stats(2));
    clearSessionStats("s1");
    expect(getSessionStats("s1")).toEqual([]);
    expect(getSessionStats("s2")).toHaveLength(1);
  });
  it("mean roll from real gravity samples; null when none usable", () => {
    expect(meanRollFromSamples([])).toBeNull();
    // flat phone: undefined roll, skipped
    expect(meanRollFromSamples([{ t: 0, g: [0, 0, 1] }])).toBeNull();
    const r = meanRollFromSamples([
      { t: 0, g: [0, 1, 0] },
      { t: 1, g: [Math.sin(0.1), Math.cos(0.1), 0] },
    ]);
    expect(r).toBeCloseTo((0.1 * 180) / Math.PI / 2, 4);
  });
});
