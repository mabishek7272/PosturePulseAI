import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { SessionRecord } from "../api/types";
import { sampleBody } from "../report/testFixtures";
import { SessionDetailPage } from "./SessionDetailPage";

vi.mock("../api/socket", () => ({
  connectToSession: () => ({ on: () => {}, disconnect: () => {} }),
}));

const session: SessionRecord = {
  id: "sess-1",
  subjectPseudoId: "subj-9",
  protocolId: "static-battery",
  protocolVersion: "v0-draft",
  deploymentContext: "home_rehab",
  consentRecordId: "c1",
  calibrationRef: null,
  subjectHeightMeters: null,
  state: "Observing",
  createdAt: "2026-10-23T09:00:00Z",
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/sessions/sess-1"]}>
      <Routes>
        <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
        <Route path="/reports/:reportId" element={<p>Report page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SessionDetailPage", () => {
  it("offers to build a draft report for this session", async () => {
    vi.spyOn(client, "getSession").mockResolvedValue(session);
    vi.spyOn(client, "listEvents").mockResolvedValue([]);
    vi.spyOn(client, "getExposureSummary").mockResolvedValue({});
    const build = vi.spyOn(client, "buildDraftReport").mockResolvedValue(sampleBody({ reportId: "rep-3" }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Build draft report" }));
    await waitFor(() => expect(screen.getByText("Report page")).toBeInTheDocument());
    expect(build).toHaveBeenCalledWith("sess-1");
  });
});
