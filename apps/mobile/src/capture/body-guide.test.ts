import { bodyGuideBox, guideKind } from "./body-guide";
import { DISTANCE_MAX, DISTANCE_MIN } from "./guidance";

describe("bodyGuideBox", () => {
  it("is centred horizontally and its body span sits inside the distance band", () => {
    const W = 768, H = 1024; // 3:4 iPad portrait: frame == view
    const b = bodyGuideBox(W, H)!;
    expect(b.x + b.w / 2).toBeCloseTo(W / 2);
    const headY = b.y + (6 / 240) * b.h;
    const feetY = b.y + (232 / 240) * b.h;
    const span = (feetY - headY) / H;
    expect(span).toBeGreaterThan(DISTANCE_MIN);
    expect(span).toBeLessThan(DISTANCE_MAX);
    expect(b.w / b.h).toBeCloseTo(100 / 240);
  });
  it("uses the cropped frame height on a tall phone", () => {
    const b = bodyGuideBox(390, 844)!;
    // cover scale = 844/4 per frame unit -> frame height spans the view
    const span = ((232 - 6) / 240) * b.h / 844;
    expect(span).toBeGreaterThan(DISTANCE_MIN);
    expect(span).toBeLessThan(DISTANCE_MAX);
  });
  it("returns null for an empty view", () => {
    expect(bodyGuideBox(0, 0)).toBeNull();
  });
  it("maps views to outline kinds", () => {
    expect(guideKind("anterior")).toBe("frontal");
    expect(guideKind("posterior")).toBe("frontal");
    expect(guideKind("left_lateral")).toBe("lateral");
    expect(guideKind("right_lateral")).toBe("lateral");
  });
});
