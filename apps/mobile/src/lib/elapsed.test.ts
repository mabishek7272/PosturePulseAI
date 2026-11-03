import { formatElapsed } from "./elapsed";

describe("formatElapsed", () => {
  it("formats m:ss", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(999)).toBe("0:00");
    expect(formatElapsed(9000)).toBe("0:09");
    expect(formatElapsed(65000)).toBe("1:05");
    expect(formatElapsed(600000)).toBe("10:00");
  });
  it("clamps negatives", () => {
    expect(formatElapsed(-5000)).toBe("0:00");
  });
});
