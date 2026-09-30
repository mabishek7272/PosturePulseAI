import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SafetyStateBadge } from "./SafetyStateBadge";

describe("SafetyStateBadge", () => {
  it("renders the state text", () => {
    render(<SafetyStateBadge state="Observing" />);
    expect(screen.getByText("Observing")).toBeInTheDocument();
  });

  it.each(["Pause", "ClinicianReview", "Unavailable"] as const)(
    "flags %s as needing attention",
    (state) => {
      render(<SafetyStateBadge state={state} />);
      expect(screen.getByText(state)).toHaveClass("safety-state-badge--attention");
    }
  );

  it.each(["Setup", "Observing", "CueEligible"] as const)("does not flag %s", (state) => {
    render(<SafetyStateBadge state={state} />);
    expect(screen.getByText(state)).not.toHaveClass("safety-state-badge--attention");
  });
});
