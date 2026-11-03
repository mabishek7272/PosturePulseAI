jest.mock("expo-sensors", () => ({ DeviceMotion: { addListener: jest.fn(), setUpdateInterval: jest.fn() } }));
import { DIRECTION_DEADBAND_DEG, directionWordX, directionWordY, emaStep, formatLevel, formatSigned, levelWithHysteresis, pitchDegrees, rollDegrees, roundTenth, signedPitchDegrees, tiltAxes } from "./level";

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

const R = (d: number) => (d * Math.PI) / 180;
/** Camera-frame gravity for a roll of `x` degrees (+ = right edge low) and a camera pitch of `y` degrees (+ = camera up). */
const gravityFor = (x: number, y: number): [number, number, number] => {
  const c = Math.cos(R(y));
  return [Math.sin(R(x)) * c, Math.cos(R(x)) * c, -Math.sin(R(y))];
};

describe("tiltAxes (signed, camera frame x right / y down / z away from camera)", () => {
  it("upright level device is 0, 0", () => {
    const t = tiltAxes([0, 1, 0]);
    expect(t.x).toBeCloseTo(0);
    expect(t.y).toBeCloseTo(0);
  });
  it("gravity with an image-right component (right edge low) is +X", () => {
    expect(tiltAxes([0.1, 0.995, 0]).x!).toBeGreaterThan(0);
    expect(tiltAxes([-0.1, 0.995, 0]).x!).toBeLessThan(0);
    expect(tiltAxes(gravityFor(7, 0)).x).toBeCloseTo(7);
    expect(tiltAxes(gravityFor(-7, 0)).x).toBeCloseTo(-7);
  });
  it("camera pointing up (gravity along -z) is +Y, down is -Y", () => {
    expect(tiltAxes([0, Math.cos(R(6)), -Math.sin(R(6))]).y).toBeCloseTo(6);
    expect(tiltAxes([0, Math.cos(R(6)), Math.sin(R(6))]).y).toBeCloseTo(-6);
  });
  it("|Y| equals the unsigned server pitch", () => {
    for (const y of [-12, -3, 0, 4, 12]) expect(Math.abs(signedPitchDegrees(gravityFor(0, y))!)).toBeCloseTo(pitchDegrees(gravityFor(0, y))!);
  });
  it("combined tilt reads both axes", () => {
    const t = tiltAxes(gravityFor(-4, 2.5));
    expect(t.x).toBeCloseTo(-4);
    expect(t.y).toBeCloseTo(2.5);
  });
  it("flat on a table: X null, Y at +/-90", () => {
    const t = tiltAxes([0, 0.02, -1]);
    expect(t.x).toBeNull();
    expect(t.y!).toBeGreaterThan(80);
    expect(tiltAxes(null)).toEqual({ x: null, y: null });
    expect(signedPitchDegrees([0, 0, 0])).toBeNull();
  });
});

describe("direction words", () => {
  it("name the low / tilted side and stay neutral near zero", () => {
    expect(directionWordX(1)).toBe("Right side low");
    expect(directionWordX(-1)).toBe("Left side low");
    expect(directionWordX(DIRECTION_DEADBAND_DEG - 0.01)).toBeNull();
    expect(directionWordX(null)).toBeNull();
    expect(directionWordY(1)).toBe("Top tilted back");
    expect(directionWordY(-1)).toBe("Top tilted forward");
    expect(directionWordY(0.1)).toBeNull();
  });
});

describe("formatSigned / roundTenth", () => {
  it("shows sign and 0.1 resolution", () => {
    expect(formatSigned(0.43)).toBe("+0.4°");
    expect(formatSigned(-1.24)).toBe("\u22121.2°");
    expect(formatSigned(-0.01)).toBe("0.0°");
    expect(formatSigned(null)).toBe("–°");
    expect(roundTenth(1.26)).toBe(1.3);
    expect(Object.is(roundTenth(-0.01), 0)).toBe(true);
    expect(roundTenth(null)).toBeNull();
  });
});

describe("emaStep", () => {
  it("starts from the first sample and clears on null", () => {
    expect(emaStep(null, 5, 16)).toBe(5);
    expect(emaStep(3, null, 16)).toBeNull();
  });
  it("alpha = 1 - exp(-dt/tau): one time constant closes 63% of the gap", () => {
    expect(emaStep(0, 10, 150, 150)).toBeCloseTo(10 * (1 - Math.exp(-1)));
  });
  it("is independent of the sample rate (two 8 ms steps = one 16 ms step)", () => {
    const two = emaStep(emaStep(0, 10, 8)!, 10, 8)!;
    expect(two).toBeCloseTo(emaStep(0, 10, 16)!);
  });
  it("restarts after a long gap and tracks a constant exactly", () => {
    expect(emaStep(0, 10, 5000)).toBe(10);
    let v: number | null = 0;
    for (let i = 0; i < 200; i++) v = emaStep(v, 4, 16);
    expect(v).toBeCloseTo(4, 3);
  });
  it("damps noise", () => {
    let v: number | null = 0;
    let max = 0;
    for (let i = 0; i < 300; i++) {
      v = emaStep(v, i % 2 ? 1 : -1, 16);
      if (i > 100) max = Math.max(max, Math.abs(v!));
    }
    expect(max).toBeLessThan(0.15);
  });
});

describe("levelWithHysteresis", () => {
  it("enters at tolerance and leaves only beyond tolerance + 0.3", () => {
    expect(levelWithHysteresis(false, 3, 5)).toBe(true);
    expect(levelWithHysteresis(false, 3.1, 0)).toBe(false);
    expect(levelWithHysteresis(true, 3.2, 0)).toBe(true);
    expect(levelWithHysteresis(true, 3.31, 0)).toBe(false);
    expect(levelWithHysteresis(true, 0, 5.3)).toBe(true);
    expect(levelWithHysteresis(true, 0, 5.31)).toBe(false);
  });
  it("does not flicker around the threshold", () => {
    let lv = false;
    const seq = [2.9, 3.1, 2.95, 3.2, 3.05, 3.4, 3.1, 2.9];
    const out = seq.map((x) => (lv = levelWithHysteresis(lv, x, 0)));
    expect(out).toEqual([true, true, true, true, true, false, false, true]);
  });
  it("unknown is never level", () => {
    expect(levelWithHysteresis(true, null, 0)).toBe(false);
    expect(levelWithHysteresis(true, 0, null)).toBe(false);
  });
});
