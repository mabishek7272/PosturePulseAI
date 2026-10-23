import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { SessionRecord } from "../api/types";
import { sampleRecord } from "../report/testFixtures";
import { ReviewQueuePage } from "./ReviewQueuePage";

const session: SessionRecord = {
  id: "sess-1",
  subjectPseudoId: "subj-9",
  protocolId: "static-battery",
  protocolVersion: "v0-draft",
  deploymentContext: "home_rehab",
  consentRecordId: "c1",
  calibrationRef: null,
  subjectHeightMeters: null,
  state: "ClinicianReview",
  createdAt: "2026-10-23T09:00:00Z",
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ReviewQueuePage />
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReviewQueuePage", () => {
  it("lists draft reports with the session's safety state and a link to review", async () => {
    const listReports = vi.spyOn(client, "listReports").mockResolvedValue([sampleRecord()]);
    vi.spyOn(client, "listSessions").mockResolvedValue([session]);
    renderPage();
    const link = await screen.findByRole("link", { name: "subj-9" });
    expect(link).toHaveAttribute("href", "/reports/rep-1");
    expect(listReports).toHaveBeenCalledWith("draft");
    const row = link.closest("tr") as HTMLElement;
    expect(within(row).getByText("ClinicianReview")).toBeInTheDocument();
    expect(within(row).getByText("2")).toBeInTheDocument();
  });

  it("falls back to the session id when the session is not in the list", async () => {
    vi.spyOn(client, "listReports").mockResolvedValue([sampleRecord()]);
    vi.spyOn(client, "listSessions").mockRejectedValue(new Error("offline"));
    renderPage();
    expect(await screen.findByRole("link", { name: "sess-1" })).toHaveAttribute("href", "/reports/rep-1");
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("switches to released reports", async () => {
    const listReports = vi.spyOn(client, "listReports").mockResolvedValue([]);
    vi.spyOn(client, "listSessions").mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(listReports).toHaveBeenCalledWith("draft"));
    await userEvent.click(screen.getByRole("button", { name: "Released" }));
    await waitFor(() => expect(listReports).toHaveBeenCalledWith("released"));
  });

  it("says when there is nothing to review", async () => {
    vi.spyOn(client, "listReports").mockResolvedValue([]);
    vi.spyOn(client, "listSessions").mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("No reports in this list.")).toBeInTheDocument();
  });

  it("shows the error rather than an empty queue", async () => {
    vi.spyOn(client, "listReports").mockRejectedValue(new Error("network down"));
    vi.spyOn(client, "listSessions").mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/Could not load reports: network down/)).toBeInTheDocument();
  });
});
