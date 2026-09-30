import type {
  DecisionEventPayload,
  EventRecord,
  ExposureEventPayload,
  MovementPhaseEventPayload,
  QualityGateFlagPayload,
  SymptomReportPayload,
} from "../api/types";
import "./EventTimeline.css";

/**
 * Renders the raw append-only event log (GET /sessions/:id/events) as a
 * human-readable timeline. Every description is derived directly from the
 * stored payload - nothing here infers or summarizes beyond what was
 * actually recorded (docs/claims-and-scope.md).
 */
export function EventTimeline({ events }: { events: EventRecord[] }) {
  const mostRecentFirst = [...events].reverse();
  return (
    <ol className="event-timeline">
      {mostRecentFirst.map((event) => (
        <li key={event.id} className={`event-timeline__item event-timeline__item--${severityClass(event)}`}>
          <span className="event-timeline__time">{new Date(event.createdAt).toLocaleString()}</span>
          <span className="event-timeline__type">{event.type}</span>
          <span className="event-timeline__detail">{describe(event)}</span>
        </li>
      ))}
      {mostRecentFirst.length === 0 && <li className="event-timeline__empty">No events recorded yet.</li>}
    </ol>
  );
}

function severityClass(event: EventRecord): "attention" | "neutral" {
  if (event.type === "decision-event") {
    const action = (event.payload as DecisionEventPayload).action;
    if (action === "cue" || action === "escalate_review") return "attention";
  }
  if (event.type === "symptom-report") return "attention";
  if (event.type === "quality-gate-flag" && (event.payload as QualityGateFlagPayload).state === "unsupported") {
    return "attention";
  }
  return "neutral";
}

function describe(event: EventRecord): string {
  switch (event.type) {
    case "decision-event": {
      const payload = event.payload as DecisionEventPayload;
      return `${payload.action} (rule ${payload.rule.ruleId}: ${payload.rule.description})`;
    }
    case "quality-gate-flag": {
      const payload = event.payload as QualityGateFlagPayload;
      return payload.state === "unsupported"
        ? `unsupported - ${payload.reasons.join(", ") || "no reason recorded"}`
        : "supported";
    }
    case "symptom-report": {
      const payload = event.payload as SymptomReportPayload;
      return `${payload.symptoms.join(", ")}${payload.severity ? ` (severity: ${payload.severity})` : ""}`;
    }
    case "exposure-event": {
      const payload = event.payload as ExposureEventPayload;
      return `${payload.postureBucket}: ${payload.validSeconds}s valid / ${payload.totalWindowSeconds}s window`;
    }
    case "movement-phase-event": {
      const payload = event.payload as MovementPhaseEventPayload;
      // ADR-005: movement-phase output is never statistically validated in
      // this phase - the timeline must not imply otherwise.
      return `predicted "${payload.predictedPhase}" (confidence ${payload.phaseConfidence.toFixed(2)}, NOT statistically validated - ADR-005)`;
    }
    default:
      return JSON.stringify(event.payload);
  }
}
