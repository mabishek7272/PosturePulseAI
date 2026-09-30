import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { AdverseEventRecord } from "../api/types";
import { AdverseEventsPage } from "./AdverseEventsPage";

function event(overrides: Partial<AdverseEventRecord> = {}): AdverseEventRecord {
  return {
    adverseEventRecordId: "ae1",
    sessionId: "s1",
    subjectPseudoId: "subj-1",
    reportedByClinicianId: "clin-1",
    relatedSymptomReportId: null,
    onsetAt: "2026-01-01T00:00:00Z",
    reportedAt: "2026-01-01T01:00:00Z",
    description: "Dizziness during exercise.",
    severity: "mild",
    serious: false,
    causality: "possible",
    outcome: "resolved",
    actionTaken: "session_paused",
    followUpRequired: false,
    reportedToEthicsBoardAt: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdverseEventsPage", () => {
  it("shows an empty state with no events", async () => {
    vi.spyOn(client, "listAdverseEvents").mockResolvedValue([]);
    render(
      <MemoryRouter>
        <AdverseEventsPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("No adverse events recorded.")).toBeInTheDocument());
  });

  it("lists real events with subject, severity, and outcome", async () => {
    vi.spyOn(client, "listAdverseEvents").mockResolvedValue([event({ subjectPseudoId: "subj-a" })]);
    render(
      <MemoryRouter>
        <AdverseEventsPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("subj-a")).toBeInTheDocument());
    expect(screen.getByText("mild")).toBeInTheDocument();
    expect(screen.getByText("resolved")).toBeInTheDocument();
    expect(screen.getByText("not yet")).toBeInTheDocument();
  });

  it("re-queries with seriousOnly when that filter is selected", async () => {
    const spy = vi.spyOn(client, "listAdverseEvents").mockResolvedValue([]);
    render(
      <MemoryRouter>
        <AdverseEventsPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(spy).toHaveBeenCalledWith(false));

    await userEvent.click(screen.getByRole("button", { name: "Serious only" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(true));
  });
});
