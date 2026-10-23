import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { AssessmentReportRecord, SessionRecord } from "../api/types";
import { sampleBody, sampleRecord } from "../report/testFixtures";
import { ReportReviewPage } from "./ReportReviewPage";

const session: SessionRecord = {
  id: "sess-1",
  subjectPseudoId: "subj-9",
  protocolId: "static-battery",
  protocolVersion: "v0-draft",
  deploymentContext: "clinic_supervised",
  consentRecordId: "c1",
  calibrationRef: null,
  subjectHeightMeters: null,
  state: "Observing",
  createdAt: "2026-10-23T09:00:00Z",
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/reports/rep-1"]}>
      <Routes>
        <Route path="/reports/:reportId" element={<ReportReviewPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function released(): AssessmentReportRecord {
  const body = sampleBody({
    status: "released",
    clinicianAssessment: { text: "Reviewed with the patient in clinic.", clinicianId: "clin-1" },
    signOff: { clinicianId: "clin-1", signedAt: "2026-10-23T11:00:00Z", contentSha256: "a".repeat(64) },
  });
  return sampleRecord({ status: "released", body, signedBy: "clin-1", signedAt: "2026-10-23T11:00:00Z" });
}

beforeEach(() => {
  vi.spyOn(client, "getSession").mockResolvedValue(session);
  vi.spyOn(client, "getAssessmentBattery").mockResolvedValue({
    version: "assessment-battery/v0-draft",
    status: "draft",
    steps: [
      { stepId: "static.anterior", title: "Front view" },
      { stepId: "static.left_lateral", title: "Left side" },
    ],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReportReviewPage", () => {
  it("renders the draft report's rows grouped by step, provenance and the not-measurable list", async () => {
    vi.spyOn(client, "getReport").mockResolvedValue(sampleRecord());
    renderPage();
    await waitFor(() => expect(screen.getByRole("region", { name: /Front view/ })).toBeInTheDocument());
    expect(client.getReport).toHaveBeenCalledWith("rep-1");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Assessment report, version 2");
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("posture-reference/v0-draft")).toBeInTheDocument();
    expect(screen.getByText("metrics/v1")).toBeInTheDocument();
    expect(screen.getByText("Craniovertebral angle")).toBeInTheDocument();
    expect(screen.getByText(/A palpated C7 marker/)).toBeInTheDocument();
    expect(await screen.findByText("Observing")).toBeInTheDocument();
    expect(client.getSession).toHaveBeenCalledWith("sess-1");
  });

  it("still renders with step ids when the battery cannot be loaded", async () => {
    vi.spyOn(client, "getReport").mockResolvedValue(sampleRecord());
    vi.spyOn(client, "getAssessmentBattery").mockRejectedValue(new Error("offline"));
    renderPage();
    await waitFor(() => expect(screen.getByRole("region", { name: /static\.anterior/ })).toBeInTheDocument());
  });

  it("shows the error rather than an empty report", async () => {
    vi.spyOn(client, "getReport").mockRejectedValue(new Error("GET /reports/rep-1 failed: 404 Not Found"));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Could not load report: .*404/)).toBeInTheDocument());
  });

  it("excludes a row with its reason and reloads the report", async () => {
    const getReport = vi.spyOn(client, "getReport").mockResolvedValue(sampleRecord());
    const exclude = vi.spyOn(client, "excludeReportRow").mockResolvedValue(sampleRecord());
    renderPage();
    const row = (await screen.findByText("Shoulder line tilt")).closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Exclude" }));
    await userEvent.type(within(row).getByLabelText("Reason for excluding"), "Hair over the shoulders");
    await userEvent.click(within(row).getByRole("button", { name: "Confirm exclusion" }));
    await waitFor(() =>
      expect(exclude).toHaveBeenCalledWith("rep-1", {
        metricKey: "static.shoulder_line_tilt",
        side: null,
        stepId: "static.anterior",
        reason: "Hair over the shoulders",
      })
    );
    await waitFor(() => expect(getReport).toHaveBeenCalledTimes(2));
  });

  it("saves the clinician's assessment", async () => {
    vi.spyOn(client, "getReport").mockResolvedValue(sampleRecord());
    const save = vi.spyOn(client, "saveClinicianAssessment").mockResolvedValue(sampleRecord());
    renderPage();
    const box = await screen.findByLabelText("Clinician's assessment");
    await userEvent.type(box, "Discussed the side view with the patient.");
    await userEvent.click(screen.getByRole("button", { name: "Save assessment" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("rep-1", "Discussed the side view with the patient."));
  });

  it("does not allow sign-off while the assessment has unsaved changes", async () => {
    vi.spyOn(client, "getReport").mockResolvedValue(sampleRecord());
    renderPage();
    await userEvent.type(await screen.findByLabelText("Clinician's assessment"), "Unsaved");
    expect(screen.getByRole("button", { name: "Sign off..." })).toBeDisabled();
  });

  it("signs off with the password once, then shows the released report", async () => {
    const getReport = vi
      .spyOn(client, "getReport")
      .mockResolvedValueOnce(sampleRecord())
      .mockResolvedValue(released());
    const signOff = vi.spyOn(client, "signOffReport").mockResolvedValue(released());
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Sign off..." }));
    await userEvent.type(screen.getByLabelText("Your password"), "pw-123");
    await userEvent.click(screen.getByRole("button", { name: "Sign off and release" }));

    await waitFor(() => expect(screen.getByText("Released")).toBeInTheDocument());
    expect(signOff).toHaveBeenCalledTimes(1);
    expect(signOff).toHaveBeenCalledWith("rep-1", "pw-123");
    expect(getReport).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("requires a reason to reject", async () => {
    vi.spyOn(client, "getReport").mockResolvedValue(sampleRecord());
    const reject = vi.spyOn(client, "rejectReport").mockResolvedValue(sampleRecord());
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Reject..." }));
    const confirm = screen.getByRole("button", { name: "Confirm rejection" });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Reason for rejecting"), "Wrong battery steps recorded");
    await userEvent.click(confirm);
    await waitFor(() => expect(reject).toHaveBeenCalledWith("rep-1", "Wrong battery steps recorded"));
  });

  it("shows a released report read-only, with the sign-off and the clinician's assessment", async () => {
    vi.spyOn(client, "getReport").mockResolvedValue(released());
    renderPage();
    await waitFor(() => expect(screen.getByText("Released")).toBeInTheDocument());
    expect(screen.getByText("Reviewed with the patient in clinic.")).toBeInTheDocument();
    expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Exclude" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign off..." })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject..." })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Clinician's assessment")).not.toBeInTheDocument();
  });
});
