import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listReports, listSessions } from "../api/client";
import type { AssessmentReportRecord, SessionRecord } from "../api/types";
import { SafetyStateBadge } from "../components/SafetyStateBadge";

type ReportFilter = "draft" | "released";

const FILTERS: Array<{ label: string; status: ReportFilter }> = [
  { label: "Drafts to review", status: "draft" },
  { label: "Released", status: "released" },
];

/** Assessment reports awaiting review (spec slice D), with each session's safety state alongside. */
export function ReviewQueuePage() {
  const [filter, setFilter] = useState<ReportFilter>("draft");
  const [reports, setReports] = useState<AssessmentReportRecord[]>([]);
  const [sessions, setSessions] = useState<Map<string, SessionRecord>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listReports(filter)
      .then((result) => {
        if (!cancelled) setReports(result);
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

  useEffect(() => {
    let cancelled = false;
    listSessions()
      .then((result) => {
        if (!cancelled) setSessions(new Map(result.map((session) => [session.id, session])));
      })
      .catch(() => {
        // The safety state is shown as Unknown rather than hiding the queue.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1>Assessment reports</h1>
      <p className="page-caption">
        Draft reports are built from the session's latest measurements and are released to the patient only
        after a clinician signs them off. The state column is the session's recorded safety state.
      </p>
      <div className="filter-bar">
        {FILTERS.map((f) => (
          <button
            key={f.status}
            className={filter === f.status ? "filter-bar__button filter-bar__button--active" : "filter-bar__button"}
            onClick={() => setFilter(f.status)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {loading && <p>Loading...</p>}
      {error && <p className="error-text">Could not load reports: {error}</p>}
      {!loading && !error && reports.length === 0 && <p>No reports in this list.</p>}
      {reports.length > 0 && (
        <table className="session-table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Version</th>
              <th>Session state</th>
              <th>Built</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => {
              const session = sessions.get(report.sessionId);
              return (
                <tr key={report.id}>
                  <td>
                    <Link to={`/reports/${report.id}`}>{session?.subjectPseudoId ?? report.sessionId}</Link>
                  </td>
                  <td>{report.reportVersion}</td>
                  <td>{session ? <SafetyStateBadge state={session.state} /> : "Unknown"}</td>
                  <td>{new Date(report.createdAt).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
