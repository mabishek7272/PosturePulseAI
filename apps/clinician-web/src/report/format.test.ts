import { describe, expect, it } from "vitest";
import type { QualityReason, ReportPosition } from "../api/types";
import {
  formatMeasurement,
  groupRowsByStep,
  positionLabel,
  reasonText,
  sideLabel,
  tierLabel,
} from "./format";

describe("formatMeasurement", () => {
  it("shows a signed value with its uncertainty in degrees", () => {
    expect(formatMeasurement(2.34, 0.81, "deg")).toBe("+2.3° ± 0.8°");
    expect(formatMeasurement(-1.25, 0.5, "deg")).toBe("-1.3° ± 0.5°");
  });

  it("never shows a negative zero", () => {
    expect(formatMeasurement(-0.01, 0.4, "deg")).toBe("0.0° ± 0.4°");
  });

  it("labels percent of stature explicitly", () => {
    expect(formatMeasurement(1.2, 0.4, "percent_stature")).toBe("+1.2 % stature ± 0.4 % stature");
  });

  it("falls back to the raw unit when it is not known, without inventing a sign", () => {
    expect(formatMeasurement(3, 1, "furlong")).toBe("3.0 furlong ± 1.0 furlong");
  });

  it("does not put a plus sign on units that cannot be negative", () => {
    expect(formatMeasurement(3, 1, "s")).toBe("3.0 s ± 1.0 s");
    expect(formatMeasurement(12, 1, "count")).toBe("12.0 ± 1.0");
    expect(formatMeasurement(40, 2, "percent")).toBe("40.0% ± 2.0%");
    expect(formatMeasurement(16, 2, "per_min")).toBe("16.0 /min ± 2.0 /min");
  });

  it("uses more decimals so a small uncertainty does not read as exact", () => {
    expect(formatMeasurement(2.345, 0.04, "deg")).toBe("+2.35° ± 0.04°");
    expect(formatMeasurement(2.3456, 0.004, "deg")).toBe("+2.346° ± 0.004°");
    expect(formatMeasurement(1, 0.0004, "deg")).toBe("+1.000° ± <0.001°");
    expect(formatMeasurement(1, 0, "deg")).toBe("+1.0° ± 0.0°");
  });
});

describe("labels", () => {
  it("gives every position a plain, neutral label", () => {
    const positions: ReportPosition[] = ["below", "within", "above", "indeterminate", "no_reference", "not_applicable"];
    const labels = positions.map(positionLabel);
    expect(labels).toEqual([
      "Below reference",
      "Within reference",
      "Above reference",
      "Uncertainty overlaps reference",
      "No reference set",
      "No value",
    ]);
  });

  it("names tiers", () => {
    expect(tierLabel("estimate")).toBe("Estimate");
    expect(tierLabel("proxy")).toBe("Proxy");
    expect(tierLabel("not_measurable")).toBe("Not measurable");
  });

  it("names sides", () => {
    expect(sideLabel("left")).toBe("Left");
    expect(sideLabel("right")).toBe("Right");
    expect(sideLabel("bilateral")).toBe("Both sides");
    expect(sideLabel(null)).toBe("");
  });

  it("explains every quality reason in plain words", () => {
    const reasons: QualityReason[] = [
      "insufficient_landmarks",
      "insufficient_scale",
      "identity_uncertain",
      "anchor_drift",
      "low_confidence",
      "occlusion",
      "wrong_view",
      "out_of_frame",
      "camera_not_level",
      "insufficient_frame_rate",
      "insufficient_frames",
      "subject_moving",
    ];
    for (const reason of reasons) {
      const text = reasonText(reason);
      expect(text).not.toContain("_");
      expect(text.length).toBeGreaterThan(5);
    }
    expect(reasonText("camera_not_level")).toBe("the camera was not level");
  });

  it("passes an unknown reason through readably", () => {
    expect(reasonText("some_new_reason")).toBe("some new reason");
  });
});

describe("groupRowsByStep", () => {
  it("groups rows in first-seen step order and keeps rows without a step", () => {
    const rows = [
      { metricKey: "a", stepId: "static.anterior" },
      { metricKey: "b", stepId: "static.left_lateral" },
      { metricKey: "c", stepId: "static.anterior" },
      { metricKey: "d" },
    ];
    const groups = groupRowsByStep(rows);
    expect(groups.map((g) => g.stepId)).toEqual(["static.anterior", "static.left_lateral", null]);
    expect(groups[0].rows.map((r) => r.metricKey)).toEqual(["a", "c"]);
    expect(groups[2].rows.map((r) => r.metricKey)).toEqual(["d"]);
  });
});
