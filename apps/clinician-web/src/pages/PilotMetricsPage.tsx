import { useEffect, useState } from "react";
import { getPilotMetrics } from "../api/client";
import type { PilotMetricsSummary } from "../api/types";

function formatRate(rate: number | null): string {
  return rate === null ? "no data yet" : `${(rate * 100).toFixed(1)}%`;
}

/** Real-time view for a study's data safety/clinical oversight group (docs/phase4/safety-monitoring-plan.md). */
export function PilotMetricsPage() {
  const [summary, setSummary] = useState<PilotMetricsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getPilotMetrics()
      .then((result) => {
        if (!cancelled) setSummary(result);
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
      <h1>Pilot safety monitoring</h1>
      <p className="page-caption">
        Computed directly from stored records, across every session - a rate shows "no data yet"
        rather than 0% until there is a real denominator to compute it from. Not a substitute for
        the oversight group's own prespecified stop criteria (docs/phase4/safety-monitoring-plan.md).
      </p>
      {loading && <p>Loading...</p>}
      {error && <p className="error-text">Could not load pilot metrics: {error}</p>}
      {summary && (
        <div className="metrics-grid">
          <div className="metrics-card">
            <h2>Sessions</h2>
            <p className="metrics-card__headline">{summary.totalSessions}</p>
            <ul>
              {Object.entries(summary.sessionsByState).map(([state, count]) => (
                <li key={state}>
                  {state}: {count}
                </li>
              ))}
            </ul>
          </div>
          <div className="metrics-card">
            <h2>Quality gate</h2>
            <p className="metrics-card__headline">{formatRate(summary.qualityGate.unsupportedRate)}</p>
            <p className="page-caption">
              unsupported ({summary.qualityGate.unsupportedCount}/{summary.qualityGate.totalFlags} flags)
            </p>
          </div>
          <div className="metrics-card">
            <h2>Decisions</h2>
            <p className="metrics-card__headline">{formatRate(summary.decisions.cueRate)}</p>
            <p className="page-caption">cue rate</p>
            <ul>
              {Object.entries(summary.decisions.byAction).map(([action, count]) => (
                <li key={action}>
                  {action}: {count}
                </li>
              ))}
            </ul>
          </div>
          <div className="metrics-card">
            <h2>Symptom reports</h2>
            <p className="metrics-card__headline">{summary.symptomReports.totalSymptomReports}</p>
            <p className="page-caption">{formatRate(summary.symptomReports.ratePerSession)} per session</p>
          </div>
          <div className="metrics-card">
            <h2>Adverse events</h2>
            <p className="metrics-card__headline">{summary.adverseEvents.totalAdverseEvents}</p>
            <p className="page-caption">{summary.adverseEvents.seriousAdverseEvents} serious</p>
          </div>
        </div>
      )}
    </div>
  );
}
