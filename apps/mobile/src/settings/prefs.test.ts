import { parseBoolPref, serialiseBoolPref } from "./prefs";

describe("prefs", () => {
  it("round-trips booleans", () => {
    expect(parseBoolPref(serialiseBoolPref(true), false)).toBe(true);
    expect(parseBoolPref(serialiseBoolPref(false), true)).toBe(false);
  });
  it("falls back to the default for missing or corrupt values", () => {
    expect(parseBoolPref(null, true)).toBe(true);
    expect(parseBoolPref(undefined, false)).toBe(false);
    expect(parseBoolPref("yes", true)).toBe(true);
  });
});
