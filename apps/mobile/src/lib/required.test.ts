import { required, sample } from "./required";

describe("required", () => {
  it("returns a present value unchanged, including falsy ones", () => {
    // 0, "", false and NaN are real values. A truthiness check here would turn a
    // legitimate 0 gravity component or frame time into a thrown error.
    expect(required(0, "x")).toBe(0);
    expect(required("", "x")).toBe("");
    expect(required(false, "x")).toBe(false);
    expect(Number.isNaN(required(Number.NaN, "x"))).toBe(true);
  });

  it("returns the same object, not a copy", () => {
    const o = { a: 1 };
    expect(required(o, "x")).toBe(o);
  });

  it("throws on undefined and on null, naming the invariant", () => {
    expect(() => required(undefined, "samples is non-empty")).toThrow("Invariant broken: samples is non-empty");
    expect(() => required(null, "mat is placed")).toThrow("Invariant broken: mat is placed");
  });

  it("does not manufacture a value for an out-of-range index", () => {
    const xs = [1, 2, 3];
    expect(() => required(xs[5], "index 5 exists")).toThrow(/index 5 exists/);
  });
});

describe("sample", () => {
  it("reads in-range values exactly, including 0 and negatives", () => {
    const buf = [0.25, -1, 0];
    expect([sample(buf, 0), sample(buf, 1), sample(buf, 2)]).toEqual([0.25, -1, 0]);
  });

  it("works on typed arrays", () => {
    expect(sample(new Float32Array([1.5, 2.5]), 1)).toBe(2.5);
  });

  it("returns NaN, not 0, out of range", () => {
    // A defaulted 0 is a plausible coordinate; NaN is visibly missing.
    expect(Number.isNaN(sample([1, 2], 2))).toBe(true);
    expect(Number.isNaN(sample([1, 2], -1))).toBe(true);
    expect(Number.isNaN(sample([], 0))).toBe(true);
  });

  it("behaves exactly as an out-of-range `undefined` did in the code it replaces", () => {
    // The whole justification. Comparisons are false and arithmetic is NaN on
    // both, so swapping buf[i] for sample(buf, i) changes no behaviour.
    const buf = [3];
    const oldRead = buf[7] as unknown as number; // what the code used to see
    const newRead = sample(buf, 7);

    for (const compare of [(v: number) => v >= 0, (v: number) => v < 0, (v: number) => v > 0.5, (v: number) => v <= 1]) {
      expect(compare(newRead)).toBe(compare(oldRead));
    }
    expect(Number.isNaN(newRead + 1)).toBe(Number.isNaN(oldRead + 1));
    expect(Number.isNaN(Math.min(newRead, 1))).toBe(Number.isNaN(Math.min(oldRead, 1)));
    expect(!(newRead >= 0.3)).toBe(!(oldRead >= 0.3));
  });
});
