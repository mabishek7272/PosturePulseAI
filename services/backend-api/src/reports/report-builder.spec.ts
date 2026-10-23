import battery from "../../../../references/assessment-battery.v0-draft.json";
import referenceFile from "../../../../references/posture-reference.v0-draft.json";
import { getValidator } from "../common/schema-registry";
import type { AssessmentBattery, MetricCatalog, MetricResult, ReferenceRangeSet } from "../battery/types";
import { ReportBuildError, buildReport, indexReferences, selectResultsForReport, type BuildReportInput } from "./report-builder";

const BATTERY = battery as AssessmentBattery;
const REFERENCES = referenceFile as ReferenceRangeSet;

const TIERS: Record<string, "estimate" | "proxy"> = {
  "static.head_lateral_tilt": "estimate",
  "static.shoulder_line_tilt": "proxy",
  "static.hip_line_tilt": "proxy",
  "static.trunk_lateral_lean": "estimate",
  "static.lateral_body_shift": "estimate",
  "static.knee_frontal_alignment": "proxy",
  "static.plumb_offset_ear": "estimate",
  "static.plumb_offset_shoulder": "estimate",
  "static.plumb_offset_hip": "estimate",
  "static.plumb_offset_knee": "estimate",
  "static.head_shoulder_angle": "proxy",
  "static.trunk_inclination": "estimate",
  "static.knee_extension": "estimate",
};

const unitOf = (key: string) =>
  key === "static.lateral_body_shift" || key.startsWith("static.plumb_offset") ? "percent_stature" : "deg";

const CATALOG: MetricCatalog = {
  metricsVersion: "metrics/v1",
  metrics: Object.entries(TIERS).map(([metricKey, tier]) => ({
    metricKey,
    label: `Label for ${metricKey}`,
    module: "static",
    tier,
    unit: unitOf(metricKey),
    side: null,
    signConvention: "positive = left side lower",
    description: "test",
  })),
  notMeasurable: [
    {
      metricKey: "static.q_angle",
      label: "Q-angle",
      reason: "Needs pelvic and patellar landmarks a 2D video cannot locate.",
      whatWouldBeNeeded: "Palpated skin markers.",
    },
  ],
};

const provenance = {
  schemaVersion: "metric-result/v0",
  modelVersion: "mediapipe-pose-full/0.10.14",
  calibrationVersion: "none/v0",
  producedAt: "2026-10-23T10:00:00Z",
  metricsVersion: "metrics/v1",
  clipSha256: "a".repeat(64),
};

let counter = 0;
function result(
  metricKey: string,
  stepId: string,
  body: Partial<MetricResult> & ({ estimate: MetricResult["estimate"] } | { unsupported: MetricResult["unsupported"] }),
  clipId = `clip-${stepId}`
): MetricResult {
  counter += 1;
  return {
    resultId: `r${counter}`,
    sessionId: "s1",
    clipId,
    stepId,
    metricKey,
    module: "static",
    tier: TIERS[metricKey],
    unit: unitOf(metricKey),
    side: null,
    provenance,
    ...body,
  } as MetricResult;
}

function input(results: MetricResult[], overrides: Partial<BuildReportInput> = {}): BuildReportInput {
  return {
    reportId: "rep-1",
    sessionId: "s1",
    reportVersion: 1,
    supersedesReportId: null,
    producedAt: "2026-10-23T12:00:00.000Z",
    battery: BATTERY,
    results,
    referenceSet: REFERENCES,
    catalog: CATALOG,
    ...overrides,
  };
}

describe("buildReport", () => {
  it("builds a schema-valid draft with one row per result, in battery order", () => {
    const results = [
      result("static.trunk_inclination", "static.left_lateral", { estimate: { value: 2, uncertainty: 0.5, framesUsed: 100 } }),
      result("static.head_lateral_tilt", "static.anterior", { estimate: { value: 0.2, uncertainty: 1, framesUsed: 300 } }),
      result("static.knee_frontal_alignment", "static.anterior", {
        side: "right",
        estimate: { value: 3, uncertainty: 1, framesUsed: 300 },
      }),
      result("static.knee_frontal_alignment", "static.anterior", {
        side: "left",
        estimate: { value: 4, uncertainty: 1, framesUsed: 300 },
      }),
    ];
    const report = buildReport(input(results));

    const validate = getValidator("assessment-report");
    expect(validate(report)).toBe(true);
    expect(report.status).toBe("draft");
    expect(report.signOff).toBeNull();
    expect(report.clinicianAssessment).toBeNull();
    expect(report.rows.map((r) => [r.stepId, r.metricKey, r.side])).toEqual([
      ["static.anterior", "static.head_lateral_tilt", null],
      ["static.anterior", "static.knee_frontal_alignment", "left"],
      ["static.anterior", "static.knee_frontal_alignment", "right"],
      ["static.left_lateral", "static.trunk_inclination", null],
    ]);
  });

  it("fills each row from its own result, reference and catalog label", () => {
    const r = result("static.trunk_inclination", "static.left_lateral", {
      estimate: { value: 2, uncertainty: 0.5, framesUsed: 100 },
    });
    const [row] = buildReport(input([r])).rows;
    expect(row).toEqual({
      stepId: "static.left_lateral",
      metricKey: "static.trunk_inclination",
      resultId: r.resultId,
      label: "Label for static.trunk_inclination",
      module: "static",
      tier: "estimate",
      unit: "deg",
      side: null,
      estimate: { value: 2, uncertainty: 0.5 },
      reference: {
        kind: "geometric",
        label: "0°",
        sourceCitation: REFERENCES.entries.find((e) => e.metricKey === "static.trunk_inclination")!.sourceCitation,
        status: "draft",
        value: 0,
      },
      position: "above",
      analysis: {
        text: "2.0° ± 0.5°; above the 0° reference by about 2.0°.",
        source: "fixed_template",
        templateId: "measured.above",
      },
      excluded: null,
      measuredBy: { modelVersion: provenance.modelVersion, metricsVersion: provenance.metricsVersion },
    });
  });

  it("gives a proxy its geometric reference and the proxy template", () => {
    const r = result("static.shoulder_line_tilt", "static.anterior", {
      estimate: { value: 0.3, uncertainty: 0.8, framesUsed: 300 },
    });
    const [row] = buildReport(input([r])).rows;
    expect(row.position).toBe("indeterminate");
    expect(row.reference?.kind).toBe("geometric");
    expect(row.analysis.templateId).toBe("proxy.indeterminate");
  });

  it("marks a metric without a reference no_reference", () => {
    const r = result("static.plumb_offset_ear", "static.left_lateral", {
      estimate: { value: 3.1, uncertainty: 0.4, framesUsed: 100 },
    });
    const [row] = buildReport(input([r])).rows;
    expect(row.reference).toBeNull();
    expect(row.position).toBe("no_reference");
    expect(row.analysis.text).toBe("3.1% of stature ± 0.4% of stature. No reference value is set for this measurement.");
  });

  it("carries the result's own measurementMethod and provenance onto the row (CLAUDE.md rule 4)", () => {
    const r = result("static.trunk_inclination", "static.left_lateral", {
      estimate: { value: 2, uncertainty: 0.5, framesUsed: 100 },
      provenance: { ...provenance, measurementMethod: "mediapipe_2d_image_plane", adapterVersion: "pyav/12.0" },
    });
    const [row] = buildReport(input([r])).rows;
    expect(row.method).toBe("mediapipe_2d_image_plane");
    expect(row.measuredBy).toEqual({
      modelVersion: provenance.modelVersion,
      adapterVersion: "pyav/12.0",
      metricsVersion: provenance.metricsVersion,
    });
    // Still compared against the reference: this is the default method.
    expect(row.position).toBe("above");
  });

  it("never compares a result measured by a non-default method against the camera-derived reference", () => {
    const r = result("static.trunk_inclination", "static.left_lateral", {
      estimate: { value: 2, uncertainty: 0.5, framesUsed: 100 },
      provenance: { ...provenance, measurementMethod: "clinician_manual" },
    });
    const [row] = buildReport(input([r])).rows;
    expect(row.method).toBe("clinician_manual");
    expect(row.reference).toBeNull();
    expect(row.position).toBe("no_reference");
  });

  it("reports an unsupported result as not_applicable with its reasons, never a value", () => {
    const r = result("static.head_lateral_tilt", "static.anterior", {
      unsupported: { reasons: ["out_of_frame", "camera_not_level"] },
    });
    const [row] = buildReport(input([r])).rows;
    expect(row.estimate).toBeNull();
    expect(row.position).toBe("not_applicable");
    expect(row.unsupportedReasons).toEqual(["out_of_frame", "camera_not_level"]);
    expect(row.reference).not.toBeNull();
    expect(row.analysis).toEqual({
      text: "Not measured: part of the body was outside the picture; the camera was not level.",
      source: "fixed_template",
      templateId: "unsupported",
    });
  });

  it("copies the standing not-measurable list from the catalog", () => {
    const report = buildReport(input([]));
    expect(report.notMeasurable).toEqual(CATALOG.notMeasurable);
    expect(report.rows).toEqual([]);
  });

  it("records the versions that produced it", () => {
    const report = buildReport(input([], { reportVersion: 3, supersedesReportId: "rep-0" }));
    expect(report.reportVersion).toBe(3);
    expect(report.supersedesReportId).toBe("rep-0");
    expect(report.provenance).toEqual({
      schemaVersion: "assessment-report/v0",
      modelVersion: "report-builder/v1",
      calibrationVersion: "none/v0",
      producedAt: "2026-10-23T12:00:00.000Z",
      metricsVersion: "metrics/v1",
      referenceFileVersion: "posture-reference/v0-draft",
    });
  });

  it("fails rather than invent a label for a metric the catalog does not describe", () => {
    const r = result("static.head_lateral_tilt", "static.anterior", { estimate: { value: 1, uncertainty: 1, framesUsed: 3 } });
    const catalog = { ...CATALOG, metrics: CATALOG.metrics.filter((m) => m.metricKey !== "static.head_lateral_tilt") };
    expect(() => buildReport(input([r], { catalog }))).toThrow(ReportBuildError);
  });

  it("fails the build when a not-measurable reason from the catalog carries a banned phrase", () => {
    const bad = `Cannot be measured; a ${"nor"}mal range is unknown.`;
    const catalog = { ...CATALOG, notMeasurable: [{ ...CATALOG.notMeasurable[0], reason: bad }] };
    expect(() => buildReport(input([], { catalog }))).toThrow(/banned/);
  });

  it("fails the build when a metric label from the catalog carries a banned phrase", () => {
    const r = result("static.head_lateral_tilt", "static.anterior", { estimate: { value: 1, uncertainty: 1, framesUsed: 3 } });
    const metrics = CATALOG.metrics.map((m) =>
      m.metricKey === "static.head_lateral_tilt" ? { ...m, label: `Head ${"scor"}e` } : m
    );
    expect(() => buildReport(input([r], { catalog: { ...CATALOG, metrics } }))).toThrow(ReportBuildError);
  });

  it("fails the build when a not-measurable row reason from a result carries a banned phrase", () => {
    const r = result("static.q_angle", "static.anterior", {
      tier: "not_measurable",
      notMeasurable: { reason: `A ${"diagno"}sis is needed first.` },
    } as never);
    const metrics = [...CATALOG.metrics, { ...CATALOG.metrics[0], metricKey: "static.q_angle", label: "Q-angle", tier: "not_measurable" as never }];
    expect(() => buildReport(input([{ ...r, unit: "deg" }], { catalog: { ...CATALOG, metrics } }))).toThrow(ReportBuildError);
  });

  it("carries the result's stepId and signConvention onto the row", () => {
    const r = result("static.trunk_inclination", "static.left_lateral", {
      estimate: { value: 2, uncertainty: 0.5, framesUsed: 100, signConvention: "positive = forward" },
    });
    const [row] = buildReport(input([r])).rows;
    expect(row.stepId).toBe("static.left_lateral");
    expect(row.signConvention).toBe("positive = forward");
  });

  it("puts the reference's numeric bounds on the row - a single value as `value`, a range as min/max", () => {
    const single = result("static.trunk_inclination", "static.left_lateral", {
      estimate: { value: 2, uncertainty: 0.5, framesUsed: 100 },
    });
    const [singleRow] = buildReport(input([single])).rows;
    expect(singleRow.reference?.value).toBe(0);
    expect(singleRow.reference?.min).toBeUndefined();
    expect(singleRow.reference?.max).toBeUndefined();

    // Every entry in the checked-in reference file is single-value today (confirmed by
    // reading references/posture-reference.v0-draft.json), so a range case needs a
    // synthetic reference set - same technique already used by the "indexes single-value
    // and range references as bounds" test further down this file. trunk_lateral_lean (not
    // hip_line_tilt) because it's tier "estimate", not "proxy" - indexReferences rejects a
    // literature reference for a proxy metric, and this range needs to be literature-kind.
    const rangedSet: ReferenceRangeSet = { ...REFERENCES, entries: [{ metricKey: "static.trunk_lateral_lean", kind: "literature", min: -2, max: 4, unit: "deg", sourceCitation: "x" }] };
    const ranged = result("static.trunk_lateral_lean", "static.anterior", {
      estimate: { value: 1, uncertainty: 0.4, framesUsed: 100 },
    });
    const [rangedRow] = buildReport(input([ranged], { referenceSet: rangedSet })).rows;
    expect(rangedRow.reference?.min).toBe(-2);
    expect(rangedRow.reference?.max).toBe(4);
    expect(rangedRow.reference?.value).toBeUndefined();
  });

  it("stepId always comes from the result, but signConvention/reference are only set when the source data has them", () => {
    const r = result("static.plumb_offset_ear", "static.left_lateral", {
      estimate: { value: 3.1, uncertainty: 0.4, framesUsed: 100 },
    });
    const [row] = buildReport(input([r])).rows;
    expect(row.reference).toBeNull();
    expect(row.stepId).toBe("static.left_lateral"); // still present - stepId always comes from the result
    expect(row.signConvention).toBeUndefined(); // the fixture's shared `provenance`/estimate has no signConvention
  });

  it("is deterministic", () => {
    const results = [
      result("static.head_lateral_tilt", "static.anterior", { estimate: { value: 1, uncertainty: 1, framesUsed: 3 } }),
    ];
    expect(buildReport(input(results))).toEqual(buildReport(input(results)));
  });
});

describe("indexReferences", () => {
  it("rejects a literature reference for a proxy metric", () => {
    const set: ReferenceRangeSet = {
      ...REFERENCES,
      entries: [
        { metricKey: "static.head_shoulder_angle", kind: "literature", min: 45, max: 55, unit: "deg", sourceCitation: "x" },
      ],
    };
    expect(() => indexReferences(set, CATALOG)).toThrow(/proxy/);
  });

  it("rejects a reference whose unit differs from the metric's unit", () => {
    const set: ReferenceRangeSet = {
      ...REFERENCES,
      entries: [{ metricKey: "static.trunk_inclination", kind: "geometric", value: 0, unit: "cm", sourceCitation: "x" }],
    };
    expect(() => indexReferences(set, CATALOG)).toThrow(/unit/);
  });

  it("rejects two references for the same metric", () => {
    const entry = REFERENCES.entries[0];
    expect(() => indexReferences({ ...REFERENCES, entries: [entry, entry] }, CATALOG)).toThrow(/more than one/);
  });

  it("indexes single-value and range references as bounds", () => {
    const set: ReferenceRangeSet = {
      ...REFERENCES,
      entries: [
        { metricKey: "static.trunk_inclination", kind: "literature", min: -2, max: 4, unit: "deg", sourceCitation: "x" },
        { metricKey: "static.head_lateral_tilt", kind: "geometric", value: 0, unit: "deg", sourceCitation: "y" },
      ],
    };
    const index = indexReferences(set, CATALOG);
    expect(index.get("static.trunk_inclination")?.bounds).toEqual({ lo: -2, hi: 4 });
    expect(index.get("static.head_lateral_tilt")?.bounds).toEqual({ lo: 0, hi: 0 });
  });

  it("accepts the checked-in reference file against the catalog", () => {
    expect(() => indexReferences(REFERENCES, CATALOG)).not.toThrow();
  });
});

describe("selectResultsForReport", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 23, 10, 0, s));

  it("uses only the newest analysed clip per step, and the newest result per key within it", () => {
    const clips = [
      { id: "old", stepId: "static.anterior", status: "analyzed", createdAt: at(1) },
      { id: "new", stepId: "static.anterior", status: "analyzed", createdAt: at(2) },
      { id: "pending", stepId: "static.anterior", status: "uploaded", createdAt: at(3) },
      { id: "broken", stepId: "static.anterior", status: "failed", createdAt: at(4) },
      { id: "lat", stepId: "static.left_lateral", status: "analyzed", createdAt: at(1) },
    ];
    const fromOld = result("static.head_lateral_tilt", "static.anterior", { estimate: { value: 9, uncertainty: 1, framesUsed: 3 } }, "old");
    const fromNewFirst = result("static.head_lateral_tilt", "static.anterior", { estimate: { value: 1, uncertainty: 1, framesUsed: 3 } }, "new");
    const fromNewRetry = result("static.head_lateral_tilt", "static.anterior", { estimate: { value: 2, uncertainty: 1, framesUsed: 3 } }, "new");
    const fromPending = result("static.hip_line_tilt", "static.anterior", { estimate: { value: 5, uncertainty: 1, framesUsed: 3 } }, "pending");
    const lateral = result("static.trunk_inclination", "static.left_lateral", { estimate: { value: 1, uncertainty: 1, framesUsed: 3 } }, "lat");

    const events = [fromOld, fromNewFirst, fromNewRetry, fromPending, lateral].map((payload, i) => ({ payload, createdAt: at(10 + i) }));
    const selected = selectResultsForReport(events, clips);
    expect(selected.map((r) => r.resultId).sort()).toEqual([fromNewRetry.resultId, lateral.resultId].sort());
  });

  it("keeps left and right results of the same metric apart", () => {
    const clips = [{ id: "c", stepId: "static.anterior", status: "analyzed", createdAt: at(1) }];
    const left = result("static.knee_frontal_alignment", "static.anterior", { side: "left", estimate: { value: 1, uncertainty: 1, framesUsed: 3 } }, "c");
    const right = result("static.knee_frontal_alignment", "static.anterior", { side: "right", estimate: { value: 2, uncertainty: 1, framesUsed: 3 } }, "c");
    const selected = selectResultsForReport(
      [left, right].map((payload, i) => ({ payload, createdAt: at(10 + i) })),
      clips
    );
    expect(selected).toHaveLength(2);
  });
});
