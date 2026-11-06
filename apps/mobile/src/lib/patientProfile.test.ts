import { intakeLines, scanCountLabel } from "./patientProfile";

describe("intakeLines", () => {
  it("lists only the fields present, in a fixed order, in plain words", () => {
    expect(intakeLines({ smoking: "former", heightCm: 172, recentAccident: true, recentAccidentDetails: "fall" })).toEqual([
      { label: "Height", value: "172 cm" },
      { label: "Smoking", value: "Former smoker" },
      { label: "Recent accident", value: "Yes (fall)" },
    ]);
  });
  it("is empty without intake", () => {
    expect(intakeLines(null)).toEqual([]);
    expect(intakeLines({})).toEqual([]);
  });
});

describe("scanCountLabel", () => {
  it("pluralises", () => {
    expect(scanCountLabel(1)).toBe("1 scan");
    expect(scanCountLabel(0)).toBe("0 scans");
  });
});
