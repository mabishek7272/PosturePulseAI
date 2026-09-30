import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { AuditLogEntryRecord } from "../api/types";
import { AuditLogPage } from "./AuditLogPage";

function entry(overrides: Partial<AuditLogEntryRecord>): AuditLogEntryRecord {
  return {
    id: "e1",
    clinicianId: "c1",
    clinicianUsername: "drchen",
    action: "view_session",
    sessionId: "s1",
    occurredAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AuditLogPage", () => {
  it("shows an empty state with no entries", async () => {
    vi.spyOn(client, "listAuditLog").mockResolvedValue([]);
    render(
      <MemoryRouter>
        <AuditLogPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("No access recorded yet.")).toBeInTheDocument());
  });

  it("lists real entries with who, what, and which session", async () => {
    vi.spyOn(client, "listAuditLog").mockResolvedValue([
      entry({ clinicianUsername: "drchen", action: "list_sessions", sessionId: null }),
    ]);
    render(
      <MemoryRouter>
        <AuditLogPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("drchen")).toBeInTheDocument());
    expect(screen.getByText("list_sessions")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows the error rather than pretending nothing was accessed", async () => {
    vi.spyOn(client, "listAuditLog").mockRejectedValue(new Error("network down"));
    render(
      <MemoryRouter>
        <AuditLogPage />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(screen.getByText(/Could not load the audit log: network down/)).toBeInTheDocument()
    );
  });
});
