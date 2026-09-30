import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EventRecord } from "../api/types";
import { EventTimeline } from "./EventTimeline";

function event(overrides: Partial<EventRecord>): EventRecord {
  return {
    id: "e1",
    sessionId: "s1",
    type: "quality-gate-flag",
    schemaId: "quality-gate-flag/v0",
    payload: {},
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("shows an empty state with no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText("No events recorded yet.")).toBeInTheDocument();
  });

  it("describes a decision-event by its action and rule, never inventing detail", () => {
    render(
      <EventTimeline
        events={[
          event({
            type: "decision-event",
            payload: {
              action: "cue",
              rule: { ruleId: "HZ-05", ruleVersion: "v0", description: "Sustained deviation from target angle" },
            },
          }),
        ]}
      />
    );
    expect(screen.getByText(/cue \(rule HZ-05: Sustained deviation from target angle\)/)).toBeInTheDocument();
  });

  it("never claims movement-phase-event output is validated (ADR-005)", () => {
    render(
      <EventTimeline
        events={[
          event({
            type: "movement-phase-event",
            payload: { predictedPhase: "descend", phaseConfidence: 0.42 },
          }),
        ]}
      />
    );
    expect(screen.getByText(/NOT statistically validated - ADR-005/)).toBeInTheDocument();
  });

  it("renders most-recent-first", () => {
    render(
      <EventTimeline
        events={[
          event({ id: "first", type: "quality-gate-flag", createdAt: "2026-01-01T00:00:00Z" }),
          event({ id: "second", type: "symptom-report", createdAt: "2026-01-02T00:00:00Z", payload: { symptoms: ["pain"] } }),
        ]}
      />
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("symptom-report");
    expect(items[1]).toHaveTextContent("quality-gate-flag");
  });
});
