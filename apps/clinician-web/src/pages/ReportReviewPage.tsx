import { useCallback, useEffect, useId, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  excludeReportRow,
  getAssessmentBattery,
  getReport,
  getSession,
  rejectReport,
  saveClinicianAssessment,
  signOffReport,
} from "../api/client";
import type { AssessmentReportRecord, ReportStatus, RowExclusion, SessionRecord } from "../api/types";
import { SafetyStateBadge } from "../components/SafetyStateBadge";
import { ReportRowsTable } from "../report/ReportRowsTable";
import { SignOffDialog } from "../report/SignOffDialog";
import "../report/report.css";

const STATUS_LABEL: Record<ReportStatus, string> = {
  draft: "Draft",
  released: "Released",
  rejected: "Rejected",
};

/**
 * Review of one assessment report (ADR-015, spec slice D). Rows describe
 * measurements only; the clinician's assessment is the single place for the
 * reviewing clinician's own interpretation. Every change is allowed only
 * while the report is a draft, and backend-api enforces the same.
 */
export function ReportReviewPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const [record, setRecord] = useState<AssessmentReportRecord | null>(null);
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [stepTitles, setStepTitles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!reportId) return;
    try {
      const result = await getReport(reportId);
      setRecord(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sessionId = record?.sessionId;
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    getSession(sessionId)
      .then((result) => {
        if (!cancelled) setSession(result);
      })
      .catch(() => {
        // The safety badge is supplementary here; the report itself still renders.
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    getAssessmentBattery()
      .then((battery) => {
        if (cancelled) return;
        setStepTitles(Object.fromEntries(battery.steps.map((step) => [step.stepId, step.title])));
      })
      .catch(() => {
        // Without the battery the rows are labelled by step id instead.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!reportId) return <p>No report id in URL.</p>;
  if (error) return <p className="error-text">Could not load report: {error}</p>;
  if (!record) return <p>Loading...</p>;

  const body = record.body;
  const editable = record.status === "draft";
  const hasDraftReference = body.rows.some((row) => row.reference?.status === "draft");

  async function runAction(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      throw err;
    }
    await load();
  }

  async function handleExclude(exclusion: RowExclusion) {
    await runAction(() => excludeReportRow(reportId!, exclusion));
  }

  return (
    <div>
      <p>
        <Link to="/reports">&larr; Back to reports</Link>
      </p>
      <h1>Assessment report, version {record.reportVersion}</h1>
      <p className="report-actions">
        <span className="report-chip">{STATUS_LABEL[record.status] ?? record.status}</span>
        {session && <SafetyStateBadge state={session.state} />}
      </p>

      <dl className="session-facts">
        <dt>Session</dt>
        <dd>
          <Link to={`/sessions/${record.sessionId}`}>{session?.subjectPseudoId ?? record.sessionId}</Link>
        </dd>
        <dt>Built</dt>
        <dd>{new Date(record.createdAt).toLocaleString()}</dd>
        <dt>Reference set</dt>
        <dd>
          <span>{body.provenance.referenceFileVersion ?? "not recorded"}</span>
          {hasDraftReference && (
            <>
              {" "}
              <span className="report-draft-badge">Draft reference</span>
            </>
          )}
        </dd>
        <dt>Metrics version</dt>
        <dd>
          <span>{body.provenance.metricsVersion ?? "not recorded"}</span>
        </dd>
        <dt>Pose model</dt>
        <dd>
          <span>{body.provenance.modelVersion}</span>
        </dd>
        {body.signOff && (
          <>
            <dt>Signed off</dt>
            <dd>
              {body.signOff.clinicianId}, {new Date(body.signOff.signedAt).toLocaleString()}
            </dd>
            <dt>Content SHA-256</dt>
            <dd>
              <code>{body.signOff.contentSha256}</code>
            </dd>
          </>
        )}
      </dl>

      <p className="page-caption">
        Rows describe 2D measurements from the recorded clips, each with its uncertainty, compared with the
        reference shown. They are not an interpretation; that belongs in the clinician's assessment below.
        {hasDraftReference && " Reference values marked Draft have not yet been reviewed by the clinical lead."}
      </p>

      <h2>Measurements</h2>
      <ReportRowsTable
        rows={body.rows}
        stepTitles={stepTitles}
        editable={editable}
        onExclude={editable ? handleExclude : undefined}
      />

      <h2>Not measurable with this system</h2>
      {body.notMeasurable.length === 0 ? (
        <p>None listed.</p>
      ) : (
        <ul>
          {body.notMeasurable.map((item) => (
            <li key={item.metricKey}>
              <strong>{item.label}</strong>
              <span>: {item.reason} </span>
              <span className="page-caption">What would be needed: {item.whatWouldBeNeeded}</span>
            </li>
          ))}
        </ul>
      )}

      <h2>Clinician's assessment</h2>
      {editable ? (
        <DraftActions
          key={record.id + (body.clinicianAssessment?.text ?? "")}
          savedText={body.clinicianAssessment?.text ?? ""}
          onSave={(text) => runAction(() => saveClinicianAssessment(reportId, text))}
          onSignOff={(password) => runAction(() => signOffReport(reportId, password))}
          onReject={(reason) => runAction(() => rejectReport(reportId, reason))}
        />
      ) : (
        <p>{body.clinicianAssessment?.text ?? "No assessment was recorded."}</p>
      )}
      {actionError && <p className="error-text">{actionError}</p>}
    </div>
  );
}

function DraftActions({
  savedText,
  onSave,
  onSignOff,
  onReject,
}: {
  savedText: string;
  onSave: (text: string) => Promise<void>;
  onSignOff: (password: string) => Promise<void>;
  onReject: (reason: string) => Promise<void>;
}) {
  const [text, setText] = useState(savedText);
  const [saving, setSaving] = useState(false);
  const [signOffOpen, setSignOffOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const assessmentId = useId();
  const rejectId = useId();
  const dirty = text !== savedText;

  async function save() {
    setSaving(true);
    try {
      await onSave(text);
    } catch {
      // runAction has already shown the error.
    } finally {
      setSaving(false);
    }
  }

  async function reject() {
    const reason = rejectReason.trim();
    if (!reason || rejecting) return;
    setRejecting(true);
    try {
      await onReject(reason);
    } catch {
      // runAction has already shown the error.
    } finally {
      setRejecting(false);
    }
  }

  return (
    <>
      <div className="report-form">
        <label htmlFor={assessmentId}>Clinician's assessment</label>
        <textarea id={assessmentId} rows={5} value={text} onChange={(event) => setText(event.target.value)} />
        <div className="report-actions">
          <button type="button" className="report-button" disabled={!dirty || saving} onClick={save}>
            {saving ? "Saving..." : "Save assessment"}
          </button>
          {dirty && <span className="page-caption">Unsaved changes. Save before signing off.</span>}
        </div>
      </div>

      <h2>Review decision</h2>
      <div className="report-actions">
        <button
          type="button"
          className="report-button report-button--primary"
          disabled={dirty}
          onClick={() => setSignOffOpen(true)}
        >
          Sign off...
        </button>
        <button type="button" className="report-button" onClick={() => setRejectOpen(true)}>
          Reject...
        </button>
      </div>

      {rejectOpen && (
        <div className="report-form">
          <label htmlFor={rejectId}>Reason for rejecting</label>
          <input id={rejectId} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} />
          <div className="report-actions">
            <button
              type="button"
              className="report-button"
              disabled={!rejectReason.trim() || rejecting}
              onClick={reject}
            >
              Confirm rejection
            </button>
            <button
              type="button"
              className="report-button report-button--quiet"
              onClick={() => {
                setRejectOpen(false);
                setRejectReason("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {signOffOpen && (
        <SignOffDialog
          onSubmit={async (password) => {
            await onSignOff(password);
            setSignOffOpen(false);
          }}
          onCancel={() => setSignOffOpen(false)}
        />
      )}
    </>
  );
}
