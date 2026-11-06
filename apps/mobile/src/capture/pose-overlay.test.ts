import {
  BONES, EMPTY_POSE, personPresent, HIDDEN, NECK_INDEX, boneSegment, coverMap, decodeMoveNet, jointPosition, poseStatusText, visibleCount,
  POSE_HOLD_MS, stabilisePts,
} from "./pose-overlay";

function raw(points: Record<number, [number, number, number]>): number[] {
  const a = new Array(51).fill(0);
  for (const [i, [y, x, s]] of Object.entries(points)) {
    a[Number(i) * 3] = y;
    a[Number(i) * 3 + 1] = x;
    a[Number(i) * 3 + 2] = s;
  }
  return a;
}

describe("decodeMoveNet", () => {
  it("undoes letterbox padding for a portrait 3:4 frame", () => {
    // 3:4 portrait in 192 box: scale .. rw = 144, rh = 192, ox = 24, oy = 0.
    const out = decodeMoveNet(raw({ 0: [0.5, 0.5, 0.9], 5: [0.25, 24 / 192, 0.9] }), 480, 640);
    expect(out[0]).toBeCloseTo(0.5);
    expect(out[1]).toBeCloseTo(0.5);
    expect(out[10]).toBeCloseTo(0); // left edge of the real image
    expect(out[11]).toBeCloseTo(0.25);
  });
  it("hides low-score and padding points", () => {
    const out = decodeMoveNet(raw({ 0: [0.5, 0.5, 0.29], 1: [0.5, 0.05, 0.9] }), 480, 640);
    expect(out[0]).toBe(HIDDEN);
    expect(out[2]).toBe(HIDDEN); // x=0.05*192 is inside padding
  });
});

describe("visibleCount", () => {
  it("counts only visible points", () => {
    expect(visibleCount(EMPTY_POSE.pts)).toBe(0);
    const pts = EMPTY_POSE.pts.slice();
    pts[0] = 0.5; pts[1] = 0.5; pts[4] = 0.1; pts[5] = 0.2;
    expect(visibleCount(pts)).toBe(2);
  });
});

describe("coverMap", () => {
  it("is identity-scaled when aspects match", () => {
    expect(coverMap(0.5, 0.5, 480, 640, 768, 1024)).toEqual([384, 512]);
  });
  it("crops the sides of a wider-than-frame view's height overflow", () => {
    // frame 3:4, view 1:1 -> scale by width, top/bottom cropped
    const p = coverMap(0.5, 0, 300, 400, 300, 300)!;
    expect(p[0]).toBeCloseTo(150);
    expect(p[1]).toBeCloseTo(-50);
  });
  it("is null with unknown frame size", () => {
    expect(coverMap(0.5, 0.5, 0, 0, 100, 100)).toBeNull();
  });
});

describe("bones", () => {
  const snap = (pts: number[]) => ({ pts, w: 100, h: 100 });
  it("has the neck bone from the nose to the shoulder midpoint", () => {
    expect(BONES).toContainEqual([0, NECK_INDEX]);
    expect(BONES).toHaveLength(13);
  });
  it("computes the shoulder midpoint", () => {
    const pts = EMPTY_POSE.pts.slice();
    pts[10] = 0.4; pts[11] = 0.4; pts[12] = 0.6; pts[13] = 0.4;
    expect(jointPosition(snap(pts), NECK_INDEX, 100, 100)).toEqual([50, 40]);
  });
  it("hides a bone when either end is hidden", () => {
    const pts = EMPTY_POSE.pts.slice();
    pts[10] = 0.4; pts[11] = 0.4;
    expect(boneSegment(snap(pts), [5, 6], 100, 100)).toBeNull();
    pts[12] = 0.6; pts[13] = 0.4;
    expect(boneSegment(snap(pts), [5, 6], 100, 100)).toEqual([40, 40, 60, 40]);
  });
});

describe("poseStatusText", () => {
  it("never claims more points than detected", () => {
    expect(poseStatusText("loaded", false, 17)).toBe("Pose guide · 17 points");
    expect(poseStatusText("loaded", false, 9)).toBe("Pose guide · 9 of 17 points");
    expect(poseStatusText("loaded", false, 0)).toBe("Pose guide · looking for a person");
    expect(poseStatusText("loading", false, 0)).toBe("Pose guide · looking for a person");
  });
  it("reports unavailable on model or resizer failure", () => {
    expect(poseStatusText("error", false, 0)).toBe("Pose guide unavailable");
    expect(poseStatusText("loaded", true, 0)).toBe("Pose guide unavailable");
  });
});

describe("personPresent (lateral)", () => {
  const all = (score: number) => Array.from({ length: 17 * 3 }, (_, i) => (i % 3 === 2 ? score : 0.5));

  it("accepts a side-on person whose far shoulder and hip are hidden", () => {
    const raw = all(0.1);
    // Near side only: ear, shoulder, elbow, wrist, hip, knee, ankle + nose.
    for (const k of [0, 3, 5, 7, 9, 11, 13, 15]) raw[k * 3 + 2] = 0.8;
    expect(personPresent(raw, true)).toBe(true);
    // The same frame is still rejected when a frontal view is expected.
    expect(personPresent(raw, false)).toBe(false);
  });

  it("still rejects a junk scene in a lateral view", () => {
    expect(personPresent(all(0.25), true)).toBe(false);
  });

  it("rejects a lateral frame with a shoulder but no hip", () => {
    const raw = all(0.1);
    for (const k of [0, 3, 5, 7, 9, 13, 15] ) raw[k * 3 + 2] = 0.8;
    expect(personPresent(raw, true)).toBe(false);
  });
});

describe("personPresent", () => {
  const all = (score: number) => Array.from({ length: 17 * 3 }, (_, i) => (i % 3 === 2 ? score : 0.5));

  it("accepts a frame with many confident keypoints including the torso", () => {
    expect(personPresent(all(0.7))).toBe(true);
  });

  it("rejects a junk scene where every score is low", () => {
    expect(personPresent(all(0.25))).toBe(false);
  });

  it("rejects few confident points even when they are high", () => {
    const raw = all(0.1);
    for (const k of [0, 1, 2, 5, 6, 11]) raw[k * 3 + 2] = 0.9;
    expect(personPresent(raw)).toBe(false);
  });

  it("rejects many confident points when the torso is not among them", () => {
    const raw = all(0.7);
    for (const k of [5, 6, 11, 12]) raw[k * 3 + 2] = 0.1;
    expect(personPresent(raw)).toBe(false);
  });
});

describe("stabilisePts", () => {
  const one = (x: number, y: number) => {
    const p = new Array(34).fill(HIDDEN);
    p[0] = x;
    p[1] = y;
    return p;
  };

  it("passes the first detection straight through", () => {
    const r = stabilisePts(EMPTY_POSE.pts, undefined, one(0.5, 0.2), 0, 1000);
    expect(r.pts.slice(0, 2)).toEqual([0.5, 0.2]);
    expect(r.seenAt[0]).toBe(1000);
    expect(r.pts[2]).toBe(HIDDEN);
  });

  it("damps a one-frame jump but follows a sustained move", () => {
    let s = stabilisePts(EMPTY_POSE.pts, undefined, one(0.5, 0.2), 0, 0);
    const jumped = stabilisePts(s.pts, s.seenAt, one(0.6, 0.2), 33, 33);
    expect(jumped.pts[0]!).toBeGreaterThan(0.5);
    expect(jumped.pts[0]!).toBeLessThan(0.56);
    s = jumped;
    for (let t = 66; t <= 1000; t += 33) s = stabilisePts(s.pts, s.seenAt, one(0.6, 0.2), 33, t);
    expect(s.pts[0]!).toBeCloseTo(0.6, 3);
  });

  it("holds a point that drops out briefly, then hides it", () => {
    const s = stabilisePts(EMPTY_POSE.pts, undefined, one(0.5, 0.2), 0, 0);
    const held = stabilisePts(s.pts, s.seenAt, EMPTY_POSE.pts, 33, POSE_HOLD_MS);
    expect(held.pts.slice(0, 2)).toEqual([0.5, 0.2]);
    const gone = stabilisePts(held.pts, held.seenAt, EMPTY_POSE.pts, 33, POSE_HOLD_MS + 1);
    expect(gone.pts[0]).toBe(HIDDEN);
  });

  it("never invents a point that was not seen", () => {
    const r = stabilisePts(EMPTY_POSE.pts, undefined, EMPTY_POSE.pts, 33, 33);
    expect(r.pts.every((v) => v === HIDDEN)).toBe(true);
  });
});
