import { BUBBLE_FULL_SCALE_DEG, bubbleOffset, bubbleTone, toleranceZone } from "./bubble";

describe("bubbleOffset", () => {
  it("centres at 0,0 and when unknown", () => {
    expect(bubbleOffset(0, 0, 40)).toEqual({ dx: 0, dy: 0 });
    expect(bubbleOffset(null, null, 40)).toEqual({ dx: 0, dy: 0 });
  });
  it("moves toward the HIGH side: right side low -> left, camera up -> up", () => {
    expect(bubbleOffset(5, 0, 40).dx).toBeCloseTo(-20);
    expect(bubbleOffset(-5, 0, 40).dx).toBeCloseTo(20);
    expect(bubbleOffset(0, 5, 40).dy).toBeCloseTo(-20);
    expect(bubbleOffset(0, -5, 40).dy).toBeCloseTo(20);
  });
  it("10 degrees reaches the rim travel and larger tilt is clamped radially", () => {
    expect(bubbleOffset(BUBBLE_FULL_SCALE_DEG, 0, 40).dx).toBeCloseTo(-40);
    const o = bubbleOffset(30, 30, 40);
    expect(Math.hypot(o.dx, o.dy)).toBeCloseTo(40);
    expect(o.dx).toBeLessThan(0);
    expect(o.dy).toBeLessThan(0);
  });
});

describe("toleranceZone / bubbleTone", () => {
  it("has semi-axes 3 and 5 degrees in the bubble scaling", () => {
    expect(toleranceZone(40)).toEqual({ rx: 12, ry: 20 });
  });
  it("green when level, amber when tilted, grey when unavailable", () => {
    expect(bubbleTone(0, 0, true)).toBe("green");
    expect(bubbleTone(6, 0, false)).toBe("amber");
    expect(bubbleTone(null, 1, false)).toBe("grey");
    expect(bubbleTone(1, null, true)).toBe("grey");
  });
});
