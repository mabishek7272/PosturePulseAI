import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listAdverseEvents } from "../api/client";
import type { AdverseEventRecord } from "../api/types";

/**
 * Read-only view of clinical-trial adverse event documentation
 * (docs/phase4/safety-monitoring-plan.md). Creating a report is API-only
 * (services/backend-api/src/adverse-events/) - this dashboard never writes,
 * same design boundary as every other page here (App.tsx).
 */
export function AdverseEventsPage() {
  const [seriousOnly, setSeriousOnly] = useState(false);
  const [events, setEvents] = useState<AdverseEventRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listAdverseEvents(seriousOnly)
      .then((result) => {
        if (!cancelled) setEvents(result);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [seriousOnly]);

  return (
    <div>
      <h1>Adverse events</h1>
      <p className="page-caption">
        Clinician-authored clinical-trial documentation - distinct from the real-time symptom-stop
        path (docs/adr/adverse-event-record schema comment). Most-recent-first.
      </p>
      <div className="filter-bar">
        <button
          className={!seriousOnly ? "filter-bar__button filter-bar__button--active" : "filter-bar__button"}
          onClick={() => setSeriousOnly(false)}
        >
          All
        </button>
        <button
          className={seriousOnly ? "filter-bar__button filter-bar__button--active" : "filter-bar__button"}
          onClick={() => setSeriousOnly(true)}
        >
          Serious only
        </button>
      </div>
      {loading && <p>Loading...</p>}
      {error && <p className="error-text">Could not load adverse events: {error}</p>}
      {!loading && !error && events.length === 0 && <p>No adverse events recorded.</p>}
      <table className="session-table">
        <thead>
          <tr>
            <th>Reported</th>
            <th>Subject</th>
            <th>Session</th>
            <th>Severity</th>
            <th>Serious</th>
            <th>Causality</th>
            <th>Outcome</th>
            <th>Ethics board reported</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.adverseEventRecordId}>
              <td>{new Date(event.reportedAt).toLocaleString()}</td>
              <td>{event.subjectPseudoId}</td>
              <td>
                {event.sessionId ? <Link to={`/sessions/${event.sessionId}`}>{event.sessionId}</Link> : "—"}
              </td>
              <td>{event.severity}</td>
              <td>{event.serious ? "yes" : "no"}</td>
              <td>{event.causality}</td>
              <td>{event.outcome}</td>
              <td>{event.reportedToEthicsBoardAt ? new Date(event.reportedToEthicsBoardAt).toLocaleString() : "not yet"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
