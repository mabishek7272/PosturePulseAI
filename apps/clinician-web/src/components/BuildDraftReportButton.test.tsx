import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import { sampleRecord } from "../report/testFixtures";
import { BuildDraftReportButton } from "./BuildDraftReportButton";

function renderButton() {
  return render(
    <MemoryRouter initialEntries={["/sessions/sess-1"]}>
      <Routes>
        <Route path="/sessions/:sessionId" element={<BuildDraftReportButton sessionId="sess-1" />} />
        <Route path="/reports/:reportId" element={<p>Report page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BuildDraftReportButton", () => {
  it("builds a draft for the session and opens it", async () => {
    const build = vi.spyOn(client, "buildDraftReport").mockResolvedValue(sampleRecord({ id: "rep-7" }));
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: "Build draft report" }));
    await waitFor(() => expect(screen.getByText("Report page")).toBeInTheDocument());
    expect(build).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledWith("sess-1");
  });

  it("shows the error and stays on the session", async () => {
    vi.spyOn(client, "buildDraftReport").mockRejectedValue(new Error("POST /sessions/sess-1/report failed: 409"));
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: "Build draft report" }));
    expect(await screen.findByText(/Could not build the draft report: .*409/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Build draft report" })).toBeEnabled();
  });
});
