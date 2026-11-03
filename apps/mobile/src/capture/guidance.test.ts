import { HIDDEN } from "./pose-overlay";
import {
  DISTANCE_MAX, DISTANCE_MIN, MIN_KEY_SCORE, SAFE_ANKLE_Y_MAX, SAFE_HEAD_Y_MIN, SAFE_X_MAX, SAFE_X_MIN, checkFraming,
  MotionTracker, bodySpan, PITCH_LIMIT_DEG, PITCH_MESSAGE, evaluateGuidance, unavailableGuidance } from "./guidance";

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

/** Confident score for every visible keypoint. */
function scoresOf(p: number[], v = 0.9): number[] {
  return Array.from({ length: 17 }, (_, i) => (p[2 * i] >= 0 ? v : 0));
}
function frame(p: number[], over: Partial<Parameters<typeof evaluateGuidance>[0]> = {}) {
  return evaluateGuidance({ pts: p, scores: scoresOf(p), ...ok, ...over });
}
function move(p: number[], i: number, x: number, y: number): number[] {
  const q = [...p];
  q[2 * i] = x;
  q[2 * i + 1] = y;
  return q;
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
    expect(g.message).toBe("Step back — your feet are cut off");
    expect(g.inFrame).toBe(false);
  });
  it("asks to move closer when small and step back when large", () => {
    expect(evaluateGuidance({ pts: standing(0.3, 0.7), ...ok }).message).toBe("Move closer");
    expect(evaluateGuidance({ pts: standing(0.06, 0.88), ...ok }).message).toBe("Step back a little");
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

describe("safe framing box (server frame gate)", () => {
  it("band is derived from the safe box and sits inside it", () => {
    expect(DISTANCE_MAX).toBeCloseTo(0.78);
    expect(DISTANCE_MIN).toBeLessThan(DISTANCE_MAX);
    expect(SAFE_ANKLE_Y_MAX + 0.06).toBeLessThan(0.98);
  });
  it("a well framed person passes with scores", () => {
    const g = frame(standing());
    expect(g.inFrame).toBe(true);
    expect(g.aligned).toBe(true);
  });
  it("feet at the bottom edge fail and say the feet are cut off", () => {
    const g = frame(standing(0.2, 0.97));
    expect(g.inFrame).toBe(false);
    expect(g.message).toBe("Step back — your feet are cut off");
    expect(frame(standing(0.2, 0.93)).inFrame).toBe(false);
  });
  it("head cut off fails", () => {
    const g = frame(standing(0.02, 0.7));
    expect(g.inFrame).toBe(false);
    expect(g.message).toBe("Step back — your head is cut off");
  });
  it("ankle y exactly on the threshold passes, just past fails", () => {
    const p = standing(0.2, 0.7);
    expect(checkFraming(move(p, 15, 0.43, SAFE_ANKLE_Y_MAX), "anterior").ok).toBe(true);
    expect(checkFraming(move(p, 15, 0.43, SAFE_ANKLE_Y_MAX + 0.001), "anterior").ok).toBe(false);
  });
  it("head y exactly on the threshold passes, just above fails", () => {
    const p = standing(0.2, 0.7);
    expect(checkFraming(move(p, 0, 0.5, SAFE_HEAD_Y_MIN), "anterior").ok).toBe(true);
    expect(checkFraming(move(p, 0, 0.5, SAFE_HEAD_Y_MIN - 0.001), "anterior").problem).toBe("head");
  });
  it("each frontal side landmark outside the x range fails; on the boundary passes", () => {
    const p = standing(0.15, 0.8);
    for (const i of [3, 4, 5, 6, 11, 12, 13, 14, 15, 16]) {
      const y = p[2 * i + 1];
      expect(checkFraming(move(p, i, SAFE_X_MIN, y), "anterior").ok).toBe(true);
      expect(checkFraming(move(p, i, SAFE_X_MAX, y), "anterior").ok).toBe(true);
      expect(checkFraming(move(p, i, SAFE_X_MIN - 0.001, y), "anterior")).toEqual({ ok: false, problem: "left" });
      expect(checkFraming(move(p, i, SAFE_X_MAX + 0.001, y), "posterior")).toEqual({ ok: false, problem: "right" });
    }
  });
  it("sideways messages use the screen's point of view", () => {
    const g = frame(standing(0.15, 0.8, 0.13));
    expect(g.message).toBe("Move toward the right of the screen");
    expect(frame(standing(0.15, 0.8, 0.87)).message).toBe("Move toward the left of the screen");
  });
  it("lateral uses the near side only: a far-side joint out of the box is ignored", () => {
    const p = standing(0.15, 0.8, 0.585);
    for (const i of [2, 4, 6, 8, 10, 12, 14, 16]) { p[2 * i] = HIDDEN; p[2 * i + 1] = HIDDEN; }
    expect(checkFraming(p, "left_lateral", scoresOf(p)).ok).toBe(true);
    // near side (left) knee out of the box fails
    expect(checkFraming(move(p, 13, 0.99, 0.6), "left_lateral", scoresOf(p)).ok).toBe(false);
    // frontal needs both sides
    expect(checkFraming(p, "anterior", scoresOf(p)).ok).toBe(false);
  });
  it("low-confidence key joints fail, exactly the minimum passes", () => {
    const p = standing();
    for (const i of [0, 3, 5, 11, 13, 15, 16]) {
      const s = scoresOf(p);
      s[i] = MIN_KEY_SCORE;
      expect(checkFraming(p, "anterior", s).ok).toBe(true);
      s[i] = MIN_KEY_SCORE - 0.01;
      expect(checkFraming(p, "anterior", s).ok).toBe(false);
    }
    expect(frame(p, { scores: scoresOf(p, 0.35) }).inFrame).toBe(false);
  });
  it("nose and ears are required", () => {
    const p = move(standing(), 0, HIDDEN, HIDDEN);
    expect(frame(p).inFrame).toBe(false);
  });
  it("band edges: span just inside passes distance", () => {
    expect(frame(standing(0.88 - DISTANCE_MAX + 0.005, 0.88)).checks[2].ok).toBe(true);
    expect(frame(standing(0.88 - DISTANCE_MIN + 0.005, 0.88)).message).toBe("Move closer");
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
