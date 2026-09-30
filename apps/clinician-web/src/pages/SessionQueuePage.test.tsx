import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { SessionRecord } from "../api/types";
import { SessionQueuePage } from "./SessionQueuePage";

function session(overrides: Partial<SessionRecord>): SessionRecord {
  return {
    id: "s1",
    subjectPseudoId: "subj-1",
    protocolId: "bodyweight-squat",
    protocolVersion: "v0-draft",
    deploymentContext: "home_rehab",
    consentRecordId: "c1",
    calibrationRef: null,
    subjectHeightMeters: null,
    state: "Observing",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SessionQueuePage", () => {
  it("lists sessions returned from the API", async () => {
    vi.spyOn(client, "listSessions").mockResolvedValue([session({ subjectPseudoId: "subj-a" })]);
    render(
      <MemoryRouter>
        <SessionQueuePage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("subj-a")).toBeInTheDocument());
  });

  it("re-queries with the selected state filter", async () => {
    const spy = vi.spyOn(client, "listSessions").mockResolvedValue([]);
    render(
      <MemoryRouter>
        <SessionQueuePage />
      </MemoryRouter>
    );
    await waitFor(() => expect(spy).toHaveBeenCalledWith(undefined));

    await userEvent.click(screen.getByRole("button", { name: "Needs review" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("ClinicianReview"));
  });

  it("shows the error rather than pretending the queue is empty", async () => {
    vi.spyOn(client, "listSessions").mockRejectedValue(new Error("network down"));
    render(
      <MemoryRouter>
        <SessionQueuePage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText(/Could not load sessions: network down/)).toBeInTheDocument());
  });
});
