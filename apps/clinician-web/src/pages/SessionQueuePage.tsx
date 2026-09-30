import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listSessions } from "../api/client";
import type { SafetyState, SessionRecord } from "../api/types";
import { SafetyStateBadge } from "../components/SafetyStateBadge";

const FILTERS: Array<{ label: string; state?: SafetyState }> = [
  { label: "All" },
  { label: "Needs review", state: "ClinicianReview" },
  { label: "Paused", state: "Pause" },
  { label: "Observing", state: "Observing" },
  { label: "Unavailable", state: "Unavailable" },
];

export function SessionQueuePage() {
  const [filter, setFilter] = useState<SafetyState | undefined>(undefined);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listSessions(filter)
      .then((result) => {
        if (!cancelled) setSessions(result);
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
  }, [filter]);

  return (
    <div>
      <h1>Session queue</h1>
      <p className="page-caption">
        Sessions ordered most-recent-first. This lists safety-FSM state as recorded by
        services/backend-api - it is not a clinical risk score (docs/claims-and-scope.md).
      </p>
      <div className="filter-bar">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            className={filter === f.state ? "filter-bar__button filter-bar__button--active" : "filter-bar__button"}
            onClick={() => setFilter(f.state)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {loading && <p>Loading...</p>}
      {error && <p className="error-text">Could not load sessions: {error}</p>}
      {!loading && !error && sessions.length === 0 && <p>No sessions match this filter.</p>}
      <table className="session-table">
        <thead>
          <tr>
            <th>Subject</th>
            <th>Protocol</th>
            <th>Context</th>
            <th>State</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.id}>
              <td>
                <Link to={`/sessions/${session.id}`}>{session.subjectPseudoId}</Link>
              </td>
              <td>
                {session.protocolId}@{session.protocolVersion}
              </td>
              <td>{session.deploymentContext}</td>
              <td>
                <SafetyStateBadge state={session.state} />
              </td>
              <td>{new Date(session.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
