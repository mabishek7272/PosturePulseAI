jest.mock("expo-sensors", () => ({ DeviceMotion: { addListener: jest.fn(), setUpdateInterval: jest.fn() } }));
import { formatLevel, pitchDegrees, rollDegrees } from "./level";

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

describe("pitchDegrees", () => {
  const rad = (d: number) => (d * Math.PI) / 180;
  it("is 0 for an upright device", () => {
    expect(pitchDegrees([0, 1, 0])).toBeCloseTo(0);
  });
  it("is asin(|gz|/|g|) in degrees, unsigned", () => {
    expect(pitchDegrees([0, Math.cos(rad(12)), Math.sin(rad(12))])).toBeCloseTo(12);
    expect(pitchDegrees([0, Math.cos(rad(8)), -Math.sin(rad(8))])).toBeCloseTo(8);
  });
  it("normalises a non-unit vector", () => {
    expect(pitchDegrees([0, 2 * Math.cos(rad(5)), 2 * Math.sin(rad(5))])).toBeCloseTo(5);
  });
  it("is 90 when the camera points straight down/up", () => {
    expect(pitchDegrees([0, 0, 1])).toBeCloseTo(90);
  });
  it("is null for invalid gravity", () => {
    expect(pitchDegrees([0, 0, 0])).toBeNull();
    expect(pitchDegrees([NaN, 1, 0])).toBeNull();
  });
});
