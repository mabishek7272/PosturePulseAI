import type { SafetyState } from "../api/types";
import "./SafetyStateBadge.css";

// A direct mirror of the safety FSM's current state
// (services/backend-api/src/safety/safety-state-machine.ts) - not a score
// this component derives or ranks on its own (docs/claims-and-scope.md, HZ-07).
const NEEDS_ATTENTION: ReadonlySet<SafetyState> = new Set(["Pause", "ClinicianReview", "Unavailable"]);

export function SafetyStateBadge({ state }: { state: SafetyState }) {
  const needsAttention = NEEDS_ATTENTION.has(state);
  return (
    <span className={`safety-state-badge ${needsAttention ? "safety-state-badge--attention" : ""}`}>{state}</span>
  );
}
