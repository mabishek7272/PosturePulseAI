import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client";
import type { PilotMetricsSummary } from "../api/types";
import { PilotMetricsPage } from "./PilotMetricsPage";

function summary(overrides: Partial<PilotMetricsSummary> = {}): PilotMetricsSummary {
  return {
    totalSessions: 0,
    sessionsByState: {},
    qualityGate: { totalFlags: 0, unsupportedCount: 0, unsupportedRate: null },
    decisions: { totalDecisions: 0, byAction: {}, cueRate: null, escalateReviewRate: null },
    symptomReports: { totalSymptomReports: 0, ratePerSession: null },
    adverseEvents: { totalAdverseEvents: 0, seriousAdverseEvents: 0, ratePerSession: null },
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PilotMetricsPage", () => {
  it("shows 'no data yet' rather than 0% when there is no data", async () => {
    vi.spyOn(client, "getPilotMetrics").mockResolvedValue(summary());
    render(<PilotMetricsPage />);
    await waitFor(() => expect(screen.getAllByText("no data yet").length).toBeGreaterThan(0));
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
  });

  it("renders real computed rates and counts", async () => {
    vi.spyOn(client, "getPilotMetrics").mockResolvedValue(
      summary({
        totalSessions: 4,
        sessionsByState: { Observing: 3, Pause: 1 },
        qualityGate: { totalFlags: 10, unsupportedCount: 2, unsupportedRate: 0.2 },
        adverseEvents: { totalAdverseEvents: 1, seriousAdverseEvents: 0, ratePerSession: 0.25 },
      })
    );
    render(<PilotMetricsPage />);
    await waitFor(() => expect(screen.getByText("20.0%")).toBeInTheDocument());
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Observing: 3")).toBeInTheDocument();
  });

  it("shows the error rather than a blank dashboard", async () => {
    vi.spyOn(client, "getPilotMetrics").mockRejectedValue(new Error("network down"));
    render(<PilotMetricsPage />);
    await waitFor(() =>
      expect(screen.getByText(/Could not load pilot metrics: network down/)).toBeInTheDocument()
    );
  });
});
