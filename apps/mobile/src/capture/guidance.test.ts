import { HIDDEN } from "./pose-overlay";
import { MotionTracker, bodySpan, PITCH_LIMIT_DEG, PITCH_MESSAGE, evaluateGuidance, unavailableGuidance } from "./guidance";

/** Standing person facing the camera, centred, head y=top, ankles y=bottom. */
function standing(top = 0.12, bottom = 0.84, cx = 0.5): number[] {
  const p = new Array(34).fill(HIDDEN);
  const set = (i: number, x: number, y: number) => {
    p[2 * i] = x;
    p[2 * i + 1] = y;
  };
  const h = bottom - top;
  set(0, cx, top);
  set(1, cx - 0.01, top - 0.01 + 0.01);
  set(2, cx + 0.01, top + 0.01);
  set(3, cx - 0.03, top + 0.02);
  set(4, cx + 0.03, top + 0.02);
  set(5, cx - 0.1, top + h * 0.2);
  set(6, cx + 0.1, top + h * 0.2);
  set(7, cx - 0.13, top + h * 0.38);
  set(8, cx + 0.13, top + h * 0.38);
  set(9, cx - 0.14, top + h * 0.52);
  set(10, cx + 0.14, top + h * 0.52);
  set(11, cx - 0.07, top + h * 0.52);
  set(12, cx + 0.07, top + h * 0.52);
  set(13, cx - 0.07, top + h * 0.75);
  set(14, cx + 0.07, top + h * 0.75);
  set(15, cx - 0.07, bottom);
  set(16, cx + 0.07, bottom);
  return p;
}

const ok = { rollDeg: 0.5, pitchDeg: 1 as number | null, motion: 0.003, view: "anterior" };

describe("evaluateGuidance", () => {
  it("passes every check for a well framed, level, steady subject", () => {
    const g = evaluateGuidance({ pts: standing(), ...ok });
    expect(g.available).toBe(true);
    expect(g.aligned).toBe(true);
    expect(g.checks.every((c) => c.ok)).toBe(true);
    expect(g.message).toMatch(/^Aligned/);
  });
  it("looks for a person when too few points", () => {
    const g = evaluateGuidance({ pts: new Array(34).fill(HIDDEN), ...ok });
    expect(g.message).toBe("Looking for a person");
    expect(g.personOk).toBe(false);
    expect(g.aligned).toBe(false);
  });
  it("asks to step back when the ankles are cut off", () => {
    const p = standing();
    p[30] = HIDDEN; p[31] = HIDDEN; p[32] = HIDDEN; p[33] = HIDDEN;
    const g = evaluateGuidance({ pts: p, ...ok });
    expect(g.message).toBe("Step back a little");
    expect(g.inFrame).toBe(false);
  });
  it("asks to move closer when small and step back when large", () => {
    expect(evaluateGuidance({ pts: standing(0.3, 0.7), ...ok }).message).toBe("Move closer");
    expect(evaluateGuidance({ pts: standing(0.04, 0.95), ...ok }).message).toBe("Step back a little");
  });
  it("directs toward the screen centre", () => {
    expect(evaluateGuidance({ pts: standing(0.12, 0.84, 0.7), ...ok }).message).toBe("Move toward the left of the screen");
    expect(evaluateGuidance({ pts: standing(0.12, 0.84, 0.3), ...ok }).message).toBe("Move toward the right of the screen");
  });
  it("level beats steady, unknown roll asks for upright", () => {
    expect(evaluateGuidance({ pts: standing(), ...ok, rollDeg: 5, motion: 0.5 }).message).toBe("Raise the phone level");
    expect(evaluateGuidance({ pts: standing(), ...ok, rollDeg: null }).message).toBe("Hold the phone upright");
  });
  it("warns about forward/back tilt above the pre-record limit, outranking everything but no person", () => {
    const tilted = evaluateGuidance({ pts: standing(), ...ok, pitchDeg: 9, rollDeg: 5, motion: 0.5 });
    expect(tilted.message).toBe(PITCH_MESSAGE);
    expect(tilted.checks.find((c) => c.id === "level")!.ok).toBe(false);
    expect(tilted.aligned).toBe(false);
    expect(evaluateGuidance({ pts: standing(0.3, 0.7), ...ok, pitchDeg: 9 }).message).toBe(PITCH_MESSAGE);
    expect(evaluateGuidance({ pts: new Array(34).fill(HIDDEN), ...ok, pitchDeg: 9 }).message).toBe("Looking for a person");
  });
  it("pitch exactly at the limit passes, just above fails", () => {
    expect(evaluateGuidance({ pts: standing(), ...ok, pitchDeg: PITCH_LIMIT_DEG }).aligned).toBe(true);
    expect(evaluateGuidance({ pts: standing(), ...ok, pitchDeg: PITCH_LIMIT_DEG + 0.01 }).aligned).toBe(false);
  });
  it("unknown pitch never counts as level", () => {
    for (const p of [null, NaN]) {
      const g = evaluateGuidance({ pts: standing(), ...ok, pitchDeg: p });
      expect(g.checks.find((c) => c.id === "level")!.ok).toBe(false);
      expect(g.aligned).toBe(false);
      expect(g.message).toBe("Hold the phone upright");
    }
  });
  it("asks to hold still when moving or when motion is unknown", () => {
    expect(evaluateGuidance({ pts: standing(), ...ok, motion: 0.05 }).message).toBe("Hold still");
    expect(evaluateGuidance({ pts: standing(), ...ok, motion: null }).message).toBe("Hold still");
  });
  it("lateral views only need the visible side", () => {
    const p = standing(0.12, 0.84, 0.585); // left-side points sit near the centreline in a side view
    // hide the whole right side (indices 4,6,8,10,12,14,16)
    for (const i of [2, 4, 6, 8, 10, 12, 14, 16]) { p[2 * i] = HIDDEN; p[2 * i + 1] = HIDDEN; }
    expect(evaluateGuidance({ pts: p, ...ok, view: "left_lateral" }).aligned).toBe(true);
    expect(evaluateGuidance({ pts: p, ...ok, view: "anterior" }).aligned).toBe(false);
  });
  it("unavailable guidance claims nothing", () => {
    const g = unavailableGuidance();
    expect(g.available).toBe(false);
    expect(g.aligned).toBe(false);
    expect(g.checks.every((c) => !c.ok)).toBe(true);
  });
  it("bodySpan is null when an end is hidden", () => {
    expect(bodySpan(standing(0.1, 0.8), "anterior")).toBeCloseTo(0.7);
    expect(bodySpan(new Array(34).fill(HIDDEN), "anterior")).toBeNull();
  });
});

describe("MotionTracker", () => {
  it("is unknown without enough history", () => {
    const m = new MotionTracker();
    m.push(standing(), 0);
    expect(m.motion()).toBeNull();
  });
  it("reads still as ~0 and swaying as larger", () => {
    const still = new MotionTracker();
    const sway = new MotionTracker();
    for (let i = 0; i < 8; i++) {
      still.push(standing(), i * 100);
      sway.push(standing(0.12, 0.84, 0.5 + (i % 2 ? 0.04 : -0.04)), i * 100);
    }
    expect(still.motion()).toBeCloseTo(0, 6);
    expect(sway.motion()!).toBeGreaterThan(0.012);
  });
  it("drops samples older than the window", () => {
    const m = new MotionTracker();
    for (let i = 0; i < 5; i++) m.push(standing(0.12, 0.84, 0.2 + i * 0.1), i * 100);
    for (let i = 0; i < 6; i++) m.push(standing(), 5000 + i * 100);
    expect(m.motion()).toBeCloseTo(0, 6);
  });
});
