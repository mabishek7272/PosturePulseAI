import { assertCentreClear, centreViolations, computeCaptureLayout, intersects, protectedColumn, ringDiameter } from "./layout";

const SIZES: [string, number, number, number, number][] = [
  ["iPad mini", 820, 1180, 24, 20],
  ["iPad Pro 11", 834, 1194, 24, 20],
  ["iPhone 15", 393, 852, 59, 34],
  ["iPhone SE", 375, 667, 20, 0],
];

describe("capture layout", () => {
  it.each(SIZES)("%s keeps the ring out of the central column and chrome short", (_n, w, h, top, bottom) => {
    const l = computeCaptureLayout(w, h, { top, bottom });
    expect(centreViolations(l)).toEqual([]);
    expect(() => assertCentreClear(l)).not.toThrow();
    expect(intersects(l.ring, protectedColumn(w, h))).toBe(false);
    expect(l.ring.x + l.ring.w).toBeLessThanOrEqual(w);
    expect(l.ring.y).toBeGreaterThan(0.08 * h);
    expect(l.ring.y + l.ring.h).toBeLessThan(0.6 * h);
  });

  it("ring is ~160 on iPad portrait and compact on phones", () => {
    expect(ringDiameter(820)).toBe(160);
    expect(ringDiameter(834)).toBe(160);
    expect(ringDiameter(393)).toBeLessThan(90);
    expect(ringDiameter(375)).toBeLessThan(90);
  });

  it("detects a ring dragged into the column", () => {
    const l = computeCaptureLayout(820, 1180, { top: 24, bottom: 20 });
    const bad = { ...l, ring: { ...l.ring, x: 300 } };
    expect(centreViolations(bad)).toContain("ring");
    expect(() => assertCentreClear(bad)).toThrow();
  });

  it("bottom controls fit the shutter and stay in the lower part", () => {
    const l = computeCaptureLayout(820, 1180, { top: 24, bottom: 20 });
    expect(l.bottomControls.h).toBeGreaterThanOrEqual(82);
    expect(l.bottomControls.y + l.bottomControls.h).toBe(1180);
    expect(l.bottomControls.h / 1180).toBeLessThan(0.13);
  });
});
