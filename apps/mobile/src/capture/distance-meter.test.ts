import { DISTANCE_MAX, DISTANCE_MIN } from "./guidance";
import { GAUGE_MAX, GAUGE_MIN, distanceBandFractions, distanceLabel, distanceMarkerFraction, distanceTone } from "./distance-meter";

describe("distance meter", () => {
  it("the guidance band sits inside the gauge range", () => {
    expect(DISTANCE_MIN).toBeGreaterThan(GAUGE_MIN);
    expect(DISTANCE_MAX).toBeLessThan(GAUGE_MAX);
  });
  it("larger span (closer) is higher on the track; clamped; null without a reading", () => {
    expect(distanceMarkerFraction(GAUGE_MAX)).toBe(0);
    expect(distanceMarkerFraction(GAUGE_MIN)).toBe(1);
    expect(distanceMarkerFraction(2)).toBe(0);
    expect(distanceMarkerFraction(0)).toBe(1);
    expect(distanceMarkerFraction(0.7)!).toBeLessThan(distanceMarkerFraction(0.6)!);
    expect(distanceMarkerFraction(null)).toBeNull();
  });
  it("band fractions come from DISTANCE_MIN/MAX", () => {
    const b = distanceBandFractions();
    expect(b.top).toBeLessThan(b.bottom);
    expect(b.top).toBeCloseTo((GAUGE_MAX - DISTANCE_MAX) / (GAUGE_MAX - GAUGE_MIN));
    expect(b.bottom).toBeCloseTo((GAUGE_MAX - DISTANCE_MIN) / (GAUGE_MAX - GAUGE_MIN));
  });
  it("labels and tones", () => {
    expect(distanceLabel("far")).toBe("Move closer");
    expect(distanceLabel("good")).toBe("Good distance");
    expect(distanceLabel("close")).toBe("Step back");
    expect(distanceLabel("none")).toBe("No person");
    expect([distanceTone("good"), distanceTone("far"), distanceTone("close"), distanceTone("none")]).toEqual(["green", "amber", "amber", "grey"]);
  });
});
