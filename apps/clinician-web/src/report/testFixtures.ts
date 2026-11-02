// Sample report data for component tests. Descriptive labels only, every value
// carries its uncertainty, and the unsupported row says why it was not measured.

import type { AssessmentReportBody, ReportRow, ReportSummary } from "../api/types";

const draftGeometric = (label: string) => ({
  kind: "geometric" as const,
  label,
  sourceCitation: "Definition: the line through both landmarks is level (Kendall et al. 2005).",
  status: "draft" as const,
});

export const sampleRows: ReportRow[] = [
  {
    metricKey: "static.head_lateral_tilt",
    resultId: "res-1",
    stepId: "static.anterior",
    label: "Head lateral tilt",
    module: "static",
    tier: "estimate",
    unit: "deg",
    side: null,
    estimate: { value: 0.4, uncertainty: 0.9 },
    reference: draftGeometric("0°"),
    position: "within",
    analysis: { text: "+0.4° ± 0.9°; within the 0° reference.", source: "fixed_template", templateId: "within/estimate" },
    excluded: null,
  },
  {
    metricKey: "static.shoulder_line_tilt",
    resultId: "res-2",
    stepId: "static.anterior",
    label: "Shoulder line tilt",
    module: "static",
    tier: "proxy",
    unit: "deg",
    side: null,
    estimate: { value: 2.6, uncertainty: 0.7 },
    reference: draftGeometric("0°"),
    position: "above",
    analysis: {
      text: "+2.6° ± 0.7°; above the 0° reference by about 1.9°.",
      source: "fixed_template",
      templateId: "above/proxy",
    },
    excluded: null,
  },
  {
    metricKey: "static.hip_line_tilt",
    resultId: "res-3",
    stepId: "static.anterior",
    label: "Hip line tilt",
    module: "static",
    tier: "proxy",
    unit: "deg",
    side: null,
    estimate: null,
    unsupportedReasons: ["out_of_frame"],
    reference: draftGeometric("0°"),
    position: "not_applicable",
    analysis: {
      text: "Not measured: part of the body was outside the frame.",
      source: "fixed_template",
      templateId: "unsupported",
    },
    excluded: null,
  },
  {
    metricKey: "static.knee_frontal_alignment",
    resultId: "res-4",
    stepId: "static.anterior",
    label: "Knee frontal alignment",
    module: "static",
    tier: "proxy",
    unit: "deg",
    side: "left",
    estimate: { value: -1.2, uncertainty: 1.5 },
    reference: null,
    position: "no_reference",
    analysis: {
      text: "-1.2° ± 1.5°. No reference value is set for this measurement.",
      source: "fixed_template",
      templateId: "no_reference/proxy",
    },
    excluded: null,
  },
  {
    metricKey: "static.trunk_inclination",
    resultId: "res-5",
    stepId: "static.left_lateral",
    label: "Trunk inclination",
    module: "static",
    tier: "estimate",
    unit: "deg",
    side: "left",
    estimate: { value: 1.1, uncertainty: 1.4 },
    reference: draftGeometric("0°"),
    position: "indeterminate",
    analysis: {
      text: "+1.1° ± 1.4°; the uncertainty overlaps the 0° reference.",
      source: "fixed_template",
      templateId: "indeterminate/estimate",
    },
    excluded: { reason: "Arms were not by the sides", clinicianId: "clin-1" },
  },
];

export function sampleBody(overrides: Partial<AssessmentReportBody> = {}): AssessmentReportBody {
  return {
    reportId: "rep-1",
    sessionId: "sess-1",
    reportVersion: 2,
    supersedesReportId: "rep-0",
    status: "draft",
    rows: sampleRows,
    notMeasurable: [
      {
        metricKey: "static.craniovertebral_angle",
        label: "Craniovertebral angle",
        reason: "Needs a marker on the C7 vertebra, which 2D video landmarks do not include.",
        whatWouldBeNeeded: "A palpated C7 marker visible in the side view.",
      },
    ],
    clinicianAssessment: null,
    signOff: null,
    provenance: {
      schemaVersion: "assessment-report/v0",
      modelVersion: "mediapipe-pose-full/0.10.14",
      calibrationVersion: "none",
      producedAt: "2026-10-23T10:00:00Z",
      metricsVersion: "metrics/v1",
      referenceFileVersion: "posture-reference/v0-draft",
    },
    ...overrides,
  };
}

/** GET /reports row shape - ReviewQueuePage.tsx reads these, not the full body. */
export function sampleSummary(overrides: Partial<ReportSummary> = {}): ReportSummary {
  return {
    id: "rep-1",
    reportId: "rep-1",
    sessionId: "sess-1",
    reportVersion: 2,
    status: "draft",
    createdAt: "2026-10-23T10:00:00Z",
    signedAt: null,
    sessionState: null,
    ...overrides,
  };
}
