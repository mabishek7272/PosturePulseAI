import battery from "../../../../references/assessment-battery.v0-draft.json";
import referenceFile from "../../../../references/posture-reference.v0-draft.json";
import { getValidator } from "../common/schema-registry";
import type { AssessmentBattery, MetricCatalog, MetricResult, ReferenceRangeSet } from "../battery/types";
import { ReportBuildError, buildReport, type BuildReportInput } from "./report-builder";

/**
 * The `annotated` tier: a value a named clinician produced by moving landmarks.
 *
 * Before this the tier sat in the enum with no payload and no `oneOf` branch, so
 * an annotated result could only be expressed by masquerading as an estimate -
 * which the report builder then refused (the catalog tier did not match) and the
 * renderer could not draw (no estimate). These tests pin the replacement.
 *
 * Nothing here says an annotated value is MORE ACCURATE, and the schema, the
 * template and these assertions are all written to avoid implying it.
 */

const BATTERY = battery as AssessmentBattery;
const REFERENCES = referenceFile as ReferenceRangeSet;

// static.head_lateral_tilt has a reference entry in the checked-in file; it is
// the metric where a wrongly-applied reference would be most visible.
const KEY = "static.head_lateral_tilt";

// The WHOLE catalog, not just the two metrics under test: `indexReferences`
// refuses a reference file naming a metric the catalog does not describe, so a
// partial catalog fails before any annotated logic is reached.
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
  notMeasurable: [],
};

const baseProvenance = {
  schemaVersion: "metric-result/v0",
  modelVersion: "clinician-annotation/1",
  calibrationVersion: "none/v0",
  producedAt: "2026-11-04T10:00:00Z",
  measurementMethod: "clinician_annotated",
};

const annotatedPayload = () => ({
  value: 3.4,
  uncertainty: 1.6,
  annotatorId: "dr.okafor",
  annotatedAt: "2026-11-04T10:05:00Z",
  sourceResultId: "r-machine-1",
  sourceFrameIndex: 120,
  adjustments: [{ landmark: "left_ear", fromPx: [610.2, 402.9] as [number, number], toPx: [606.0, 411.5] as [number, number] }],
});

function annotated(overrides: Record<string, unknown> = {}, metricKey = KEY): MetricResult {
  return {
    resultId: "r-annot-1",
    sessionId: "s1",
    clipId: "clip-1",
    stepId: "static.anterior",
    metricKey,
    module: "static",
    tier: "annotated",
    unit: "deg",
    side: null,
    annotated: annotatedPayload(),
    provenance: baseProvenance,
    ...overrides,
  } as unknown as MetricResult;
}

function input(results: MetricResult[]): BuildReportInput {
  return {
    reportId: "rep-1",
    sessionId: "s1",
    reportVersion: 1,
    supersedesReportId: null,
    producedAt: "2026-11-04T12:00:00.000Z",
    battery: BATTERY,
    results,
    referenceSet: REFERENCES,
    catalog: CATALOG,
  };
}

const validate = (r: unknown) => getValidator("metric-result")(r) as boolean;

describe("metric-result schema: the annotated branch", () => {
  it("accepts a well-formed annotated result", () => {
    expect(validate(annotated())).toBe(true);
  });

  it("REFUSES an annotated result that also carries an estimate", () => {
    // The check that an early draft of the oneOf would have failed: branch 1
    // never mentioned `annotated`, so estimate+annotated matched that branch
    // alone and validated. Every branch has to exclude the others.
    expect(validate(annotated({ estimate: { value: 1, uncertainty: 1, framesUsed: 5 } }))).toBe(false);
  });

  it.each(["unsupported", "notMeasurable"] as const)("REFUSES annotated alongside %s", (extra) => {
    const payload =
      extra === "unsupported"
        ? { unsupported: { reasons: ["occlusion"] } }
        : { notMeasurable: { reason: "x", whatWouldBeNeeded: "y" } };
    expect(validate(annotated(payload))).toBe(false);
  });

  it("REFUSES tier=annotated with no annotated payload (the old masquerade)", () => {
    const masquerading = annotated({ annotated: undefined, estimate: { value: 1, uncertainty: 1, framesUsed: 5 } });
    expect(validate(masquerading)).toBe(false);
  });

  it("REFUSES an annotated payload on a result whose tier is not annotated", () => {
    expect(validate(annotated({ tier: "estimate" }))).toBe(false);
  });

  it("REFUSES an annotated result with no measurementMethod", () => {
    // Because report-builder reads an ABSENT method as the default 2D one and
    // compares the row against reference ranges written for that method.
    const { measurementMethod: _omitted, ...withoutMethod } = baseProvenance;
    expect(validate(annotated({ provenance: withoutMethod }))).toBe(false);
  });

  it.each(["mediapipe_2d_image_plane", "clinician_manual", "entered", "markerless_3d"])(
    "REFUSES an annotated result declaring method %s",
    (method) => {
      expect(validate(annotated({ provenance: { ...baseProvenance, measurementMethod: method } }))).toBe(false);
    }
  );

  it("REFUSES an annotation with no adjustments", () => {
    // That would be a machine result carrying a clinician's name.
    expect(validate(annotated({ annotated: { ...annotatedPayload(), adjustments: [] } }))).toBe(false);
  });

  it.each(["annotatorId", "annotatedAt", "sourceResultId", "sourceFrameIndex", "uncertainty", "value", "adjustments"])(
    "REFUSES an annotation missing %s",
    (field) => {
      const payload: Record<string, unknown> = { ...annotatedPayload() };
      delete payload[field];
      expect(validate(annotated({ annotated: payload }))).toBe(false);
    }
  );

  it("REFUSES a negative uncertainty and an unexpected field", () => {
    expect(validate(annotated({ annotated: { ...annotatedPayload(), uncertainty: -1 } }))).toBe(false);
    expect(validate(annotated({ annotated: { ...annotatedPayload(), confidence: 0.99 } }))).toBe(false);
  });

  it("leaves every non-annotated result exactly as valid as before", () => {
    const estimate = {
      resultId: "r1", sessionId: "s1", metricKey: KEY, module: "static", tier: "estimate", unit: "deg", side: null,
      estimate: { value: 1, uncertainty: 0.5, framesUsed: 50 },
      provenance: { ...baseProvenance, measurementMethod: "mediapipe_2d_image_plane" },
    };
    expect(validate(estimate)).toBe(true);
    expect(validate({ ...estimate, estimate: undefined, tier: "not_measurable", notMeasurable: { reason: "x", whatWouldBeNeeded: "y" } })).toBe(true);
  });
});

describe("buildReport with an annotated result", () => {
  it("builds a schema-valid row that says a clinician placed it, with no reference", () => {
    const report = buildReport(input([annotated()]));
    expect(getValidator("assessment-report")(report)).toBe(true);

    const [row] = report.rows;
    expect(row.tier).toBe("annotated");
    expect(row.method).toBe("clinician_annotated");
    expect(row.estimate).toEqual({ value: 3.4, uncertainty: 1.6 });
    expect(row.analysis.templateId).toBe("annotated.no_reference");
    expect(row.analysis.text).toMatch(/adjusted by a clinician/);
  });

  it("NEVER draws a reference comparison, even for a metric that has one", () => {
    // static.head_lateral_tilt has a checked-in reference band. A machine
    // estimate of it is compared against that band; a clinician's placement is a
    // non-default method and must not be.
    const withReference = REFERENCES.entries.some((e) => e.metricKey === KEY);
    expect(withReference).toBe(true);
    const [row] = buildReport(input([annotated()])).rows;
    expect(row.reference).toBeNull();
    expect(row.position).toBe("no_reference");
  });

  it("carries who placed it onto the row (CLAUDE.md rule 4)", () => {
    const [row] = buildReport(input([annotated()])).rows;
    expect(row.annotation).toEqual({
      annotatorId: "dr.okafor",
      annotatedAt: "2026-11-04T10:05:00Z",
      sourceResultId: "r-machine-1",
      adjustmentCount: 1,
    });
    expect(row.measuredBy?.modelVersion).toBe("clinician-annotation/1");
  });

  it("does not launder a proxy into an estimate", () => {
    const proxy = annotated({}, "static.shoulder_line_tilt");
    const [row] = buildReport(input([proxy])).rows;
    expect(row.analysis.text).toMatch(/Proxy measurement: describes landmark geometry only\./);
  });

  it("gives an estimate-tier metric no proxy caveat", () => {
    const [row] = buildReport(input([annotated()])).rows;
    expect(row.analysis.text).not.toMatch(/Proxy/);
  });

  it("states nothing about accuracy anywhere in the row", () => {
    // 'Clinician Verified' was the wording first proposed. 'Verified' says the
    // placement was checked and found right, and moving a landmark corrects the
    // model's misplacement, not the static landmark-to-bone and soft-tissue
    // offsets that dominate the error. The web client already says
    // 'Clinician-annotated'.
    const [row] = buildReport(input([annotated()])).rows;
    expect(JSON.stringify(row)).not.toMatch(/verified|validated|accurate|confirmed|diagno[s]/i); // bracket form: the lint bans the literal stem
  });

  it("refuses an annotated result whose method is not clinician_annotated", () => {
    // The schema already forbids it; the builder re-checks because it is the last
    // stop before a report a clinician signs.
    const wrongMethod = annotated({ provenance: { ...baseProvenance, measurementMethod: "mediapipe_2d_image_plane" } });
    expect(() => buildReport(input([wrongMethod]))).toThrow(ReportBuildError);
    expect(() => buildReport(input([wrongMethod]))).toThrow(/clinician_annotated/);
  });

  it("refuses an annotated result with the method omitted rather than treating it as the 2D default", () => {
    const { measurementMethod: _omitted, ...bare } = baseProvenance;
    expect(() => buildReport(input([annotated({ provenance: bare })]))).toThrow(/clinician_annotated/);
  });

  it("refuses an annotated result with no payload, or with an estimate beside it", () => {
    expect(() => buildReport(input([annotated({ annotated: undefined })]))).toThrow(/annotated payload/);
    expect(() =>
      buildReport(input([annotated({ estimate: { value: 1, uncertainty: 1, framesUsed: 5 } })]))
    ).toThrow(/annotated payload/);
  });

  it("still refuses a genuine tier mismatch for every other tier", () => {
    // Allowing annotated through must not loosen the check for the rest.
    const mismatched = {
      resultId: "r2", sessionId: "s1", stepId: "static.anterior", metricKey: KEY, module: "static",
      tier: "proxy", unit: "deg", side: null,
      estimate: { value: 1, uncertainty: 1, framesUsed: 5 },
      provenance: { ...baseProvenance, measurementMethod: "mediapipe_2d_image_plane" },
    } as unknown as MetricResult;
    expect(() => buildReport(input([mismatched]))).toThrow(/catalog says/);
  });

  it("is deterministic", () => {
    expect(buildReport(input([annotated()]))).toEqual(buildReport(input([annotated()])));
  });
});
