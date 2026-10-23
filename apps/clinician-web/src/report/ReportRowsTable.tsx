import { useId, useState } from "react";
import type { ReportRow, RowExclusion } from "../api/types";
import {
  DEFAULT_MEASUREMENT_METHOD,
  TIER_HINT,
  formatMeasurement,
  groupRowsByStep,
  measurementMethodLabel,
  positionLabel,
  reasonText,
  sideLabel,
  tierLabel,
} from "./format";
import "./report.css";

interface ReportRowsTableProps {
  rows: ReportRow[];
  /** stepId -> battery step title; unknown steps fall back to the id. */
  stepTitles: Record<string, string>;
  /** Only a draft report can be changed (spec slice B). */
  editable: boolean;
  onExclude?: (exclusion: RowExclusion) => Promise<void>;
}

/**
 * The report's measurement rows, grouped by battery step. Positions are shown
 * as plain words in identical styling whatever they say: nothing here ranks,
 * colours or combines the rows.
 */
export function ReportRowsTable({ rows, stepTitles, editable, onExclude }: ReportRowsTableProps) {
  const groups = groupRowsByStep(rows);
  if (rows.length === 0) return <p>This report has no measurement rows.</p>;

  return (
    <>
      {groups.map((group) => (
        <StepSection
          key={group.stepId ?? "__none__"}
          stepId={group.stepId}
          title={group.stepId ? (stepTitles[group.stepId] ?? group.stepId) : "Step not recorded"}
          rows={group.rows}
          editable={editable}
          onExclude={onExclude}
        />
      ))}
    </>
  );
}

function StepSection({
  stepId,
  title,
  rows,
  editable,
  onExclude,
}: {
  stepId: string | null;
  title: string;
  rows: ReportRow[];
  editable: boolean;
  onExclude?: (exclusion: RowExclusion) => Promise<void>;
}) {
  const headingId = useId();
  return (
    <section className="report-step" aria-labelledby={headingId}>
      <h3 id={headingId} className="report-step__title">
        {title}
        {stepId && title !== stepId && <span className="report-step__id"> ({stepId})</span>}
      </h3>
      <div className="report-table-scroll">
        <table className="session-table report-table">
          <thead>
            <tr>
              <th>Measurement</th>
              <th>Tier</th>
              <th>Value</th>
              <th>Reference</th>
              <th>Position</th>
              <th>Quality and notes</th>
              <th>Analysis</th>
              {editable && <th>Review</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <ReportRowView
                key={`${row.metricKey}|${row.side ?? ""}|${row.stepId ?? ""}`}
                row={row}
                editable={editable}
                onExclude={onExclude}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReportRowView({
  row,
  editable,
  onExclude,
}: {
  row: ReportRow;
  editable: boolean;
  onExclude?: (exclusion: RowExclusion) => Promise<void>;
}) {
  const reasons = row.unsupportedReasons ?? [];
  const side = sideLabel(row.side);
  return (
    <tr className={row.excluded ? "report-row report-row--excluded" : "report-row"}>
      <td>
        <span className="report-label">{row.label}</span>
        {side && (
          <>
            {" "}
            <span className="report-side">{side}</span>
          </>
        )}
      </td>
      <td>
        <span className="report-chip" title={TIER_HINT[row.tier]}>
          {tierLabel(row.tier)}
        </span>
      </td>
      <td className="report-value">
        {row.estimate ? formatMeasurement(row.estimate.value, row.estimate.uncertainty, row.unit) : "Not measured"}
        {row.estimate && row.signConvention && <small className="report-citation">Sign: {row.signConvention}</small>}
        {row.method && row.method !== DEFAULT_MEASUREMENT_METHOD && (
          <small className="report-citation">Method: {measurementMethodLabel(row.method)}</small>
        )}
      </td>
      <td>
        {row.reference ? (
          <>
            <span className="report-reference">{row.reference.label}</span>
            {row.reference.status === "draft" && (
              <>
                {" "}
                <span className="report-draft-badge">Draft reference</span>
              </>
            )}
            <small className="report-citation">{row.reference.sourceCitation}</small>
          </>
        ) : (
          <span>None</span>
        )}
      </td>
      <td>
        <span className="report-position" data-position={row.position}>
          {positionLabel(row.position)}
        </span>
      </td>
      <td>
        {reasons.length > 0 && (
          <ul className="report-reasons">
            {reasons.map((reason) => (
              <li key={reason}>{reasonText(reason)}</li>
            ))}
          </ul>
        )}
        {row.excluded && <p className="report-excluded">Excluded: {row.excluded.reason}</p>}
      </td>
      <td className="report-analysis">{row.analysis.text}</td>
      {editable && (
        <td>{!row.excluded && onExclude && <ExcludeControl row={row} onExclude={onExclude} />}</td>
      )}
    </tr>
  );
}

function ExcludeControl({ row, onExclude }: { row: ReportRow; onExclude: (exclusion: RowExclusion) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const trimmed = reason.trim();

  if (!open) {
    return (
      <button type="button" className="report-button" onClick={() => setOpen(true)}>
        Exclude
      </button>
    );
  }

  async function confirm() {
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onExclude({ metricKey: row.metricKey, side: row.side, stepId: row.stepId ?? null, reason: trimmed });
      setOpen(false);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not exclude the row.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="report-exclude">
      <label htmlFor={inputId}>Reason for excluding</label>
      <input id={inputId} value={reason} onChange={(event) => setReason(event.target.value)} autoFocus />
      <div className="report-exclude__actions">
        <button type="button" className="report-button" disabled={!trimmed || submitting} onClick={confirm}>
          Confirm exclusion
        </button>
        <button
          type="button"
          className="report-button report-button--quiet"
          onClick={() => {
            setOpen(false);
            setReason("");
            setError(null);
          }}
        >
          Cancel
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
