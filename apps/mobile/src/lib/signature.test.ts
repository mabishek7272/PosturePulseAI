import { hasMinimumInk, serialiseSignature, strokeToPath, totalLength, type Stroke } from "./signature";

const line = (n: number, step: number): Stroke => Array.from({ length: n }, (_, i) => ({ x: i * step, y: 0 }));

describe("signature", () => {
  it("measures length across strokes", () => {
    expect(totalLength([line(3, 10), line(2, 5)])).toBe(25);
    expect(totalLength([])).toBe(0);
  });
  it("rejects a dot or tiny scratch", () => {
    expect(hasMinimumInk([])).toBe(false);
    expect(hasMinimumInk([[{ x: 1, y: 1 }]])).toBe(false);
    expect(hasMinimumInk([line(20, 0.5)])).toBe(false);
  });
  it("rejects a long jump with too few points", () => {
    expect(hasMinimumInk([line(3, 100)])).toBe(false);
  });
  it("accepts a real stroke, and multiple strokes summed", () => {
    expect(hasMinimumInk([line(12, 8)])).toBe(true);
    expect(hasMinimumInk([line(5, 8), line(5, 8)])).toBe(true);
  });
  it("serialises to path strings", () => {
    expect(serialiseSignature([])).toBe("");
    expect(strokeToPath([{ x: 0, y: 0 }, { x: 4, y: 4 }])).toBe("M0 0L4 4");
    const d = serialiseSignature([line(4, 10), line(3, 10)]);
    expect(d.startsWith("M0 0Q10 0 15 0Q20 0 25 0L30 0")).toBe(true);
    expect((d.match(/M/g) ?? []).length).toBe(2);
  });
});
