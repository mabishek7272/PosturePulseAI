import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "./api/client";
import { App } from "./App";
import { clearToken, setToken } from "./auth/tokenStore";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

beforeEach(() => {
  setToken("a.valid.token");
  vi.spyOn(client, "listReports").mockResolvedValue([]);
  vi.spyOn(client, "listSessions").mockResolvedValue([]);
  vi.spyOn(client, "searchPatients").mockResolvedValue([]);
});

afterEach(() => {
  clearToken();
  vi.restoreAllMocks();
});

describe("App routes and navigation", () => {
  it("links to the report queue and the patient register from the header", () => {
    renderAt("/");
    const nav = screen.getByRole("navigation");
    expect(nav.querySelector('a[href="/reports"]')).not.toBeNull();
    expect(nav.querySelector('a[href="/patients"]')).not.toBeNull();
  });

  it("renders the review queue at /reports", async () => {
    renderAt("/reports");
    expect(await screen.findByRole("heading", { name: /report/i })).toBeInTheDocument();
  });

  it("renders the patient register at /patients", async () => {
    renderAt("/patients");
    expect(await screen.findByRole("heading", { name: "Add a patient" })).toBeInTheDocument();
  });
});
