import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReportRow } from "../api/types";
import { ReportSummary } from "./ReportSummary";

const row = (over: Partial<ReportRow>): ReportRow =>
  ({
    stepId: "static.anterior", metricKey: "static.x", resultId: "r", label: "X", module: "static", tier: "proxy", unit: "deg", side: null,
    estimate: { value: 1, uncertainty: 0.5 }, reference: null, position: "no_reference",
    analysis: { text: "t", source: "fixed_template", templateId: "t" }, excluded: null, ...over,
  }) as ReportRow;

describe("ReportSummary", () => {
  it("counts measured, not measured, no reference and excluded, and names the reasons", () => {
    render(
      <ReportSummary
        patientName="Ada Example"
        visitCode="v-1"
        scannedAt="2026-11-06T10:00:00Z"
        rows={[
          row({}),
          row({ reference: { kind: "geometric", label: "0°", sourceCitation: "c", status: "draft" }, position: "within" }),
          row({ estimate: null, unsupportedReasons: ["subject_moving"] }),
          row({ estimate: null, unsupportedReasons: ["subject_moving", "out_of_frame"] }),
          row({ excluded: { reason: "r", clinicianId: "c" } }),
        ]}
      />,
    );
    expect(screen.getByText("Ada Example")).toBeInTheDocument();
    expect(screen.getByLabelText("Report summary")).toHaveTextContent("2 of 4");
    expect(screen.getByText("not measured").previousSibling).toHaveTextContent("2");
    expect(screen.getByText("without a reference").previousSibling).toHaveTextContent("1");
    expect(screen.getByText("excluded by a clinician").previousSibling).toHaveTextContent("1");
    expect(screen.getByText(/Not measured because/)).toHaveTextContent(/\(2\)/);
  });

  it("says plainly when the visit is not linked to a patient", () => {
    render(<ReportSummary patientName={null} visitCode={null} scannedAt={null} rows={[]} />);
    expect(screen.getByText("Not linked to a patient")).toBeInTheDocument();
  });
});
