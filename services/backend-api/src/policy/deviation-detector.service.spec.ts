import { DeviationDetectorService } from "./deviation-detector.service";

function anglesFor(jointName: string, degrees: number) {
  return [{ jointName, thetaRadians: (degrees * Math.PI) / 180 }];
}

describe("DeviationDetectorService", () => {
  let detector: DeviationDetectorService;

  beforeEach(() => {
    detector = new DeviationDetectorService();
  });

  it("never fires when the exercise has no targetJointAngles", () => {
    for (let i = 0; i < 10; i++) {
      const result = detector.evaluate("s1", "e1", anglesFor("leftKnee", 30), undefined, 10);
      expect(result.sustained).toBe(false);
    }
  });

  it("does not fire on a single out-of-tolerance frame", () => {
    const targets = [{ jointName: "leftKnee", targetDegrees: 170 }];
    const result = detector.evaluate("s1", "e1", anglesFor("leftKnee", 100), targets, 12);
    expect(result.sustained).toBe(false);
  });

  it("fires only after enough consecutive out-of-tolerance frames", () => {
    const targets = [{ jointName: "leftKnee", targetDegrees: 170 }];
    let result;
    for (let i = 0; i < 4; i++) {
      result = detector.evaluate("s1", "e1", anglesFor("leftKnee", 100), targets, 12);
      expect(result.sustained).toBe(false);
    }
    result = detector.evaluate("s1", "e1", anglesFor("leftKnee", 100), targets, 12);
    expect(result.sustained).toBe(true);
    expect(result.jointName).toBe("leftKnee");
    expect(result.deviationDegrees).toBeCloseTo(70, 0);
  });

  it("resets the streak once the angle returns within tolerance", () => {
    const targets = [{ jointName: "leftKnee", targetDegrees: 170 }];
    for (let i = 0; i < 4; i++) {
      detector.evaluate("s1", "e1", anglesFor("leftKnee", 100), targets, 12);
    }
    // Back within tolerance - streak must reset, not carry over.
    detector.evaluate("s1", "e1", anglesFor("leftKnee", 168), targets, 12);
    const result = detector.evaluate("s1", "e1", anglesFor("leftKnee", 100), targets, 12);
    expect(result.sustained).toBe(false);
  });

  it("does not fabricate a deviation for a joint with no matching target", () => {
    const targets = [{ jointName: "rightKnee", targetDegrees: 170 }];
    for (let i = 0; i < 10; i++) {
      const result = detector.evaluate("s1", "e1", anglesFor("leftKnee", 30), targets, 5);
      expect(result.sustained).toBe(false);
    }
  });
});
