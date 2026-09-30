import { RepCounterService } from "./rep-counter.service";

function anglesFor(jointName: string, degrees: number) {
  return [{ jointName, thetaRadians: (degrees * Math.PI) / 180 }];
}

describe("RepCounterService", () => {
  let counter: RepCounterService;

  beforeEach(() => {
    counter = new RepCounterService();
  });

  it("counts one rep per full descend-then-ascend cycle", () => {
    const sequence = [170, 150, 120, 100, 100, 120, 150, 170, 170, 150, 120, 100, 120, 150, 170];
    let last = 0;
    for (const degrees of sequence) {
      last = counter.update("s1", "e1", "leftKnee", anglesFor("leftKnee", degrees));
    }
    expect(last).toBe(2);
  });

  it("ignores jitter below the noise-floor threshold", () => {
    const sequence = [170, 171, 170, 169, 170, 171];
    let last = 0;
    for (const degrees of sequence) {
      last = counter.update("s1", "e1", "leftKnee", anglesFor("leftKnee", degrees));
    }
    expect(last).toBe(0);
  });

  it("does not advance when the tracked joint is missing from the frame", () => {
    const before = counter.update("s1", "e1", "leftKnee", anglesFor("leftKnee", 170));
    const after = counter.update("s1", "e1", "leftKnee", anglesFor("rightKnee", 100));
    expect(after).toBe(before);
  });

  it("keeps separate counts per session+exercise", () => {
    counter.update("s1", "e1", "leftKnee", anglesFor("leftKnee", 170));
    counter.update("s1", "e1", "leftKnee", anglesFor("leftKnee", 100));
    counter.update("s1", "e1", "leftKnee", anglesFor("leftKnee", 170));
    expect(counter.getCount("s1", "e1")).toBe(1);
    expect(counter.getCount("s2", "e1")).toBe(0);
  });
});
