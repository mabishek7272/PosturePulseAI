import { telemetryRows } from "./telemetry";
import { EMPTY_TELEMETRY } from "./use-capture-analysis";

jest.mock("react-native-reanimated", () => ({}));

describe("telemetryRows", () => {
  it("shows dashes, never zeros or OK, when nothing is known", () => {
    const rows = telemetryRows(EMPTY_TELEMETRY);
    expect(rows.every((r) => r.value === "–" && r.tone === "unknown")).toBe(true);
  });

  it("judges each reading against the same limits the guidance uses", () => {
    const rows = telemetryRows({ ...EMPTY_TELEMETRY, rollDeg: 1.2, pitchDeg: 7, span: 0.6, motion: 0.02, confidence: 0.8, visiblePoints: 15 });
    const tone = (k: string) => rows.find((r) => r.key === k)!.tone;
    expect(tone("roll")).toBe("ok");
    expect(tone("pitch")).toBe("warn");
    expect(tone("distance")).toBe("ok");
    expect(tone("motion")).toBe("warn");
    expect(rows.find((r) => r.key === "motion")!.value).toBe("20");
    expect(rows.find((r) => r.key === "confidence")!.value).toBe("80% · 15/17 points");
  });
});
