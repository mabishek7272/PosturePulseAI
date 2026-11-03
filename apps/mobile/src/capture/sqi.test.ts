import { addFrame, bandFor, emptyAccumulator, formatRemaining, milestoneCrossed, starsFor, summarise, type FrameSample } from "./sqi";

const good = (tMs: number): FrameSample => ({ tMs, confident: true, inFrame: true, conf: 0.7, steady: true, rollDeg: 0 });

describe("summarise", () => {
  it("is unavailable, not 0, with no frames (model not loaded)", () => {
    const s = summarise(emptyAccumulator());
    expect(s.sqi).toBeNull();
    expect(s.band).toBeNull();
    expect(starsFor(s.sqi)).toBeNull();
    expect(s.framesAnalysed).toBe(0);
  });
  it("is unavailable below the minimum frame count", () => {
    const a = emptyAccumulator();
    for (let i = 0; i < 3; i++) addFrame(a, good(i * 100));
    expect(summarise(a).sqi).toBeNull();
  });
  it("is 100 for perfect conditions", () => {
    const a = emptyAccumulator();
    for (let i = 0; i < 20; i++) addFrame(a, good(i * 100));
    const s = summarise(a);
    expect(s.sqi).toBe(100);
    expect(s.band).toBe("Excellent");
    expect(s.framesKept).toBe(20);
    expect(s.framesFiltered).toBe(0);
  });
  it("is 0 (a real, measured 0) when everything is bad over many frames", () => {
    const a = emptyAccumulator();
    for (let i = 0; i < 20; i++) addFrame(a, { tMs: i * 100, confident: false, inFrame: false, conf: 0, steady: false, rollDeg: null });
    const s = summarise(a);
    expect(s.sqi).toBe(0);
    expect(s.band).toBe("Low");
    expect(s.framesFiltered).toBe(20);
  });
  it("weights the components", () => {
    const a = emptyAccumulator();
    // half the frames not in frame / not confident: C=F=0.5; conf 0.5 -> Q=0.5; steady+level always
    for (let i = 0; i < 20; i++) {
      const bad = i % 2 === 0;
      addFrame(a, { tMs: i * 100, confident: !bad, inFrame: !bad, conf: 0.5, steady: true, rollDeg: 1 });
    }
    // 0.25*0.5 + 0.25*0.5 + 0.2*0.5 + 0.2 + 0.1 = 0.65
    expect(summarise(a).sqi).toBe(65);
    expect(summarise(a).framesKept).toBe(10);
  });
  it("treats unknown roll as not level and ignores non-finite confidence", () => {
    const a = emptyAccumulator();
    for (let i = 0; i < 10; i++) addFrame(a, { ...good(i * 100), rollDeg: null, conf: NaN });
    // 0.25 + 0.25 + 0 + 0.2 + 0 = 0.7
    expect(summarise(a).sqi).toBe(70);
  });
});

describe("bands and stars", () => {
  it("band thresholds", () => {
    expect(bandFor(0)).toBe("Low");
    expect(bandFor(39)).toBe("Low");
    expect(bandFor(40)).toBe("Fair");
    expect(bandFor(64)).toBe("Fair");
    expect(bandFor(65)).toBe("Good");
    expect(bandFor(84)).toBe("Good");
    expect(bandFor(85)).toBe("Excellent");
  });
  it("star thresholds", () => {
    expect(starsFor(0)).toBe(1);
    expect(starsFor(54)).toBe(1);
    expect(starsFor(55)).toBe(2);
    expect(starsFor(79)).toBe(2);
    expect(starsFor(80)).toBe(3);
    expect(starsFor(100)).toBe(3);
    expect(starsFor(NaN)).toBeNull();
  });
});

describe("steady streak", () => {
  it("tracks the longest continuous run and resets on a break", () => {
    const a = emptyAccumulator();
    for (let i = 0; i <= 30; i++) addFrame(a, good(i * 100)); // 3.0 s
    addFrame(a, { ...good(3100), steady: false });
    for (let i = 0; i <= 10; i++) addFrame(a, good(3200 + i * 100)); // 1.0 s
    expect(summarise(a).longestSteadySeconds).toBe(3);
  });
  it("a gap in frames ends the streak", () => {
    const a = emptyAccumulator();
    for (let i = 0; i <= 10; i++) addFrame(a, good(i * 100)); // 1.0 s
    for (let i = 0; i <= 5; i++) addFrame(a, good(5000 + i * 100)); // 0.5 s after a gap
    expect(summarise(a).longestSteadySeconds).toBe(1);
  });
});

describe("milestones and formatting", () => {
  it("fires once when crossing", () => {
    expect(milestoneCrossed(9.8, 10.1)).toBe(10);
    expect(milestoneCrossed(10.1, 10.4)).toBeNull();
    expect(milestoneCrossed(0, 0.5)).toBeNull();
  });
  it("formats remaining time", () => {
    expect(formatRemaining(0, 30)).toBe("0:30");
    expect(formatRemaining(0.2, 30)).toBe("0:30");
    expect(formatRemaining(29.1, 30)).toBe("0:01");
    expect(formatRemaining(50, 30)).toBe("0:00");
    expect(formatRemaining(0, 75)).toBe("1:15");
  });
});
