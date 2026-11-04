import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReportRowsTable } from "./ReportRowsTable";
import { sampleRows } from "./testFixtures";

const stepTitles = { "static.anterior": "Front view", "static.left_lateral": "Left side" };

function renderTable(props: Partial<Parameters<typeof ReportRowsTable>[0]> = {}) {
  return render(<ReportRowsTable rows={sampleRows} stepTitles={stepTitles} editable={false} {...props} />);
}

function rowFor(label: string): HTMLElement {
  return screen.getByText(label).closest("tr") as HTMLElement;
}

describe("ReportRowsTable", () => {
  it("groups rows under their step titles", () => {
    renderTable();
    const front = screen.getByRole("region", { name: /Front view/ });
    const side = screen.getByRole("region", { name: /Left side/ });
    expect(within(front).getByText("Shoulder line tilt")).toBeInTheDocument();
    expect(within(front).queryByText("Trunk inclination")).not.toBeInTheDocument();
    expect(within(side).getByText("Trunk inclination")).toBeInTheDocument();
  });

  it("shows each value with its uncertainty, the reference with its citation, position and tier", () => {
    renderTable();
    const row = rowFor("Shoulder line tilt");
    expect(within(row).getByText("+2.6° ± 0.7°")).toBeInTheDocument();
    expect(within(row).getByText("0°")).toBeInTheDocument();
    expect(within(row).getByText(/Kendall et al\. 2005/)).toBeInTheDocument();
    expect(within(row).getByText("Above reference")).toBeInTheDocument();
    expect(within(row).getByText("Proxy")).toBeInTheDocument();
    expect(within(row).getByText("+2.6° ± 0.7°; above the 0° reference by about 1.9°.")).toBeInTheDocument();
  });

  it("shows the row's sign convention when the report carries one, and invents none otherwise", () => {
    const rows = sampleRows.map((row) =>
      row.metricKey === "static.shoulder_line_tilt" ? { ...row, signConvention: "positive = right side lower" } : row
    );
    renderTable({ rows });
    expect(within(rowFor("Shoulder line tilt")).getByText("Sign: positive = right side lower")).toBeInTheDocument();
    expect(within(rowFor("Head lateral tilt")).queryByText(/^Sign:/)).not.toBeInTheDocument();
  });

  it("shows the measurement method only when it isn't the default camera estimate", () => {
    const rows = sampleRows.map((row) =>
      row.metricKey === "static.shoulder_line_tilt" ? { ...row, method: "clinician_manual" as const } : row
    );
    renderTable({ rows });
    expect(within(rowFor("Shoulder line tilt")).getByText("Method: Clinician manual measurement")).toBeInTheDocument();
    expect(within(rowFor("Head lateral tilt")).queryByText(/^Method:/)).not.toBeInTheDocument();
  });

  it("marks draft references with a Draft badge", () => {
    renderTable();
    expect(within(rowFor("Head lateral tilt")).getByText("Draft reference")).toBeInTheDocument();
    expect(within(rowFor("Knee frontal alignment")).queryByText("Draft reference")).not.toBeInTheDocument();
  });

  it("shows unsupported rows as not measured, with the reasons in plain words", () => {
    renderTable();
    const row = rowFor("Hip line tilt");
    expect(within(row).getByText("Not measured")).toBeInTheDocument();
    expect(within(row).getByText("part of the body was outside the frame")).toBeInTheDocument();
    expect(within(row).getByText("No value")).toBeInTheDocument();
  });

  it("shows rows without a reference and the side", () => {
    renderTable();
    const row = rowFor("Knee frontal alignment");
    expect(within(row).getByText("No reference set")).toBeInTheDocument();
    expect(within(row).getByText("Left")).toBeInTheDocument();
  });

  it("keeps excluded rows visible with the exclusion reason", () => {
    renderTable();
    const row = rowFor("Trunk inclination");
    expect(within(row).getByText(/Excluded: Arms were not by the sides/)).toBeInTheDocument();
    expect(within(row).getByText("Uncertainty overlaps reference")).toBeInTheDocument();
  });

  it("is colour-neutral: every position is rendered with the same styling", () => {
    const { container } = renderTable();
    const positions = [...container.querySelectorAll("[data-position]")];
    expect(positions.length).toBe(sampleRows.length);
    const classNames = new Set(positions.map((el) => el.className));
    expect(classNames.size).toBe(1);
    for (const el of positions) expect((el as HTMLElement).style.color).toBe("");
  });

  it("offers no Exclude action when the report is not editable", () => {
    renderTable();
    expect(screen.queryByRole("button", { name: /Exclude/ })).not.toBeInTheDocument();
  });

  it("requires a reason before a row can be excluded", async () => {
    const onExclude = vi.fn().mockResolvedValue(undefined);
    renderTable({ editable: true, onExclude });
    const row = rowFor("Shoulder line tilt");
    await userEvent.click(within(row).getByRole("button", { name: "Exclude" }));

    const confirm = within(row).getByRole("button", { name: "Confirm exclusion" });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(row).getByLabelText("Reason for excluding"), "   ");
    expect(confirm).toBeDisabled();
    await userEvent.click(confirm);
    expect(onExclude).not.toHaveBeenCalled();

    await userEvent.type(within(row).getByLabelText("Reason for excluding"), "Loose clothing over the shoulders");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onExclude).toHaveBeenCalledTimes(1);
    expect(onExclude).toHaveBeenCalledWith({
      metricKey: "static.shoulder_line_tilt",
      side: null,
      stepId: "static.anterior",
      reason: "Loose clothing over the shoulders",
    });
  });

  it("does not offer Exclude on a row that is already excluded", () => {
    renderTable({ editable: true, onExclude: vi.fn() });
    expect(within(rowFor("Trunk inclination")).queryByRole("button", { name: "Exclude" })).not.toBeInTheDocument();
  });

  it("falls back to the step id when no title is known", () => {
    render(<ReportRowsTable rows={sampleRows} stepTitles={{}} editable={false} />);
    expect(screen.getByRole("region", { name: /static\.anterior/ })).toBeInTheDocument();
  });
});

describe("an annotated row", () => {
  const annotatedRow = {
    metricKey: "static.head_lateral_tilt",
    resultId: "res-annot",
    stepId: "static.anterior",
    label: "Head lateral tilt",
    module: "static" as const,
    tier: "annotated" as const,
    unit: "deg",
    side: null,
    estimate: { value: 3.4, uncertainty: 1.6 },
    reference: null,
    position: "no_reference" as const,
    analysis: {
      text: "3.4° ± 1.6°. Landmark positions were adjusted by a clinician. No reference value is set for this measurement.",
      source: "fixed_template" as const,
      templateId: "annotated.no_reference",
    },
    excluded: null,
    method: "clinician_annotated" as const,
    annotation: { annotatorId: "dr.okafor", annotatedAt: "2026-11-04T10:05:00Z", sourceResultId: "r-machine-1", adjustmentCount: 2 },
  };

  it("says a clinician placed it, by name, and that no reference applies", () => {
    render(<ReportRowsTable rows={[annotatedRow]} stepTitles={{}} editable={false} />);
    expect(screen.getByText("Annotated")).toBeInTheDocument();
    expect(screen.getByText("Method: Clinician-annotated")).toBeInTheDocument();
    expect(screen.getByText("Landmarks adjusted by dr.okafor (2 points)")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("explains the tier without claiming the value is checked or more accurate", () => {
    render(<ReportRowsTable rows={[annotatedRow]} stepTitles={{}} editable={false} />);
    const chip = screen.getByText("Annotated");
    const hint = chip.getAttribute("title") ?? "";
    expect(hint).toMatch(/clinician adjusted the landmark positions/i);
    expect(hint).toMatch(/does not remove the static offsets/i);
    expect(`${hint} ${document.body.textContent}`).not.toMatch(/verified|validated|accurate|confirmed/i);
  });
});
