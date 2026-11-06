import type { ReportRow } from "../api/types";
import { reasonText } from "./format";
import "./report.css";

/**
 * Counts and reasons only: what was measured, what could not be, and why. It states facts about
 * the data and nothing about the person: no score, no verdict, no ranking. Interpretation is the
 * clinician's assessment below.
 */
export function ReportSummary({
  rows,
  patientName,
  visitCode,
  scannedAt,
}: {
  rows: ReportRow[];
  patientName: string | null;
  visitCode: string | null;
  scannedAt: string | null;
}) {
  const live = rows.filter((r) => !r.excluded);
  const measured = live.filter((r) => r.estimate);
  const notMeasured = live.filter((r) => !r.estimate);
  const noReference = measured.filter((r) => !r.reference).length;
  const excluded = rows.length - live.length;

  const reasonCounts = new Map<string, number>();
  for (const row of notMeasured) {
    for (const reason of row.unsupportedReasons ?? []) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  const topReasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <section className="report-summary" aria-label="Report summary">
      <div className="report-summary__who">
        <div className="report-summary__label">Patient</div>
        <div className="report-summary__name">{patientName ?? "Not linked to a patient"}</div>
        <div className="report-summary__meta">
          {scannedAt ? `Scanned ${new Date(scannedAt).toLocaleString()}` : null}
          {visitCode ? ` · visit ${visitCode}` : null}
        </div>
      </div>
      <div className="report-summary__stats">
        <div className="report-stat">
          <div className="report-stat__num">
            {measured.length}
            <span> of {live.length}</span>
          </div>
          <div className="report-stat__label">measured</div>
        </div>
        <div className="report-stat">
          <div className="report-stat__num">{notMeasured.length}</div>
          <div className="report-stat__label">not measured</div>
        </div>
        <div className="report-stat">
          <div className="report-stat__num">{noReference}</div>
          <div className="report-stat__label">without a reference</div>
        </div>
        {excluded > 0 && (
          <div className="report-stat">
            <div className="report-stat__num">{excluded}</div>
            <div className="report-stat__label">excluded by a clinician</div>
          </div>
        )}
      </div>
      {topReasons.length > 0 && (
        <p className="report-summary__why">
          Not measured because:{" "}
          {topReasons.map(([reason, count], i) => (
            <span key={reason}>
              {i > 0 ? "; " : ""}
              {reasonText(reason).toLowerCase()} ({count})
            </span>
          ))}
          .
        </p>
      )}
    </section>
  );
}
