jest.mock("expo-sensors", () => ({ DeviceMotion: { addListener: jest.fn(), setUpdateInterval: jest.fn() } }));
import { formatLevel, rollDegrees } from "./level";

describe("rollDegrees", () => {
  it("is 0 for an upright level device", () => {
    expect(rollDegrees([0, 1, 0])).toBeCloseTo(0);
  });
  it("reports tilt in degrees", () => {
    const a = (10 * Math.PI) / 180;
    expect(rollDegrees([Math.sin(a), Math.cos(a), 0])).toBeCloseTo(10);
    expect(rollDegrees([-Math.sin(a), Math.cos(a), 0])).toBeCloseTo(-10);
  });
  it("is null when the device lies flat", () => {
    expect(rollDegrees([0, 0.05, -1])).toBeNull();
  });
});

describe("formatLevel", () => {
  it("formats magnitude with one decimal", () => {
    expect(formatLevel(0.8)).toBe("0.8°");
    expect(formatLevel(-3.24)).toBe("3.2°");
  });
  it("never shows negative zero", () => {
    expect(formatLevel(-0.01)).toBe("0.0°");
  });
  it("shows a dash without a reading", () => {
    expect(formatLevel(null)).toBe("–°");
  });
});
