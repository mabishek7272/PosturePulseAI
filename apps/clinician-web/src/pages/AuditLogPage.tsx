import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listAuditLog } from "../api/client";
import type { AuditLogEntryRecord } from "../api/types";

/** Who has looked at what, and when - the auditability docs/adr/010-clinician-authentication.md promised. */
export function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntryRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listAuditLog(200)
      .then((result) => {
        if (!cancelled) setEntries(result);
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
  }, []);

  return (
    <div>
      <h1>Audit log</h1>
      <p className="page-caption">
        Every clinician read of session data, most-recent-first. Covers the routes gated by login
        (docs/adr/010-clinician-authentication.md) - it does not see traffic outside that gate
        (device-facing endpoints, the WebSocket gateway - see docs/adr/009-clinician-web-trust-model.md).
      </p>
      {loading && <p>Loading...</p>}
      {error && <p className="error-text">Could not load the audit log: {error}</p>}
      {!loading && !error && entries.length === 0 && <p>No access recorded yet.</p>}
      <table className="session-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Clinician</th>
            <th>Action</th>
            <th>Session</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>{new Date(entry.occurredAt).toLocaleString()}</td>
              <td>{entry.clinicianUsername}</td>
              <td>{entry.action}</td>
              <td>
                {entry.sessionId ? <Link to={`/sessions/${entry.sessionId}`}>{entry.sessionId}</Link> : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
