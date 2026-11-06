import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { createPatient, erasePatient, listPatientSessions, searchPatients } from "../api/client";
import type { NewPatient, PatientRecord, SessionRecord } from "../api/types";
import { SafetyStateBadge } from "../components/SafetyStateBadge";
import "./patients.css";

/**
 * Patient register (ADR-017, spec slice D): search, add, and see which
 * sessions are linked to a patient. Names, dates of birth and contacts are
 * decrypted by backend-api and held only in this page's memory - never put in
 * the URL, browser storage or any record. Sessions are linked from the iOS
 * Clinic mode flow, not here.
 */
export function PatientRegisterPage() {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PatientRecord | null>(null);
  const searchSeq = useRef(0);

  const runSearch = useCallback(async (text: string) => {
    const seq = ++searchSeq.current;
    setLoading(true);
    setSearchError(null);
    try {
      const result = await searchPatients(text);
      if (seq === searchSeq.current) setPatients(result);
    } catch (err) {
      if (seq === searchSeq.current) setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === searchSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runSearch("");
  }, [runSearch]);

  function onSearch(event: FormEvent) {
    event.preventDefault();
    void runSearch(query.trim());
  }

  function onCreated(patient: PatientRecord) {
    setPatients((current) => [patient, ...current.filter((p) => p.id !== patient.id)]);
    setSelected(patient);
  }

  return (
    <div>
      <h1>Patients</h1>
      <p className="page-caption">
        The register keeps patient identifiers separate from session records. Sessions are linked to a patient when
        a clinician runs the battery in Clinic mode.
      </p>

      <div className="patients-layout">
        <section className="patients-layout__list">
          <form className="filter-bar" role="search" onSubmit={onSearch}>
            <label htmlFor={searchId} className="visually-hidden">
              Search patients
            </label>
            <input
              id={searchId}
              className="patients-input"
              type="search"
              placeholder="Name, date of birth or contact"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" className="filter-bar__button">
              Search
            </button>
          </form>

          {loading && <p>Loading...</p>}
          {searchError && <p className="error-text">Could not load patients: {searchError}</p>}
          {!loading && !searchError && patients.length === 0 && <p>No patients match this search.</p>}
          {patients.length > 0 && (
            <ul className="patients-list">
              {patients.map((patient) => (
                <li key={patient.id}>
                  <button
                    type="button"
                    className={
                      selected?.id === patient.id
                        ? "patients-list__item patients-list__item--selected"
                        : "patients-list__item"
                    }
                    aria-pressed={selected?.id === patient.id}
                    onClick={() => setSelected(patient)}
                  >
                    {patient.name}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <NewPatientForm onCreated={onCreated} />
        </section>

        <section className="patients-layout__detail">
          {selected ? (
            <PatientDetail
              patient={selected}
              onErased={() => {
                setPatients((list) => list.filter((p) => p.id !== selected.id));
                setSelected(null);
              }}
            />
          ) : <p>Select a patient to see their linked sessions.</p>}
        </section>
      </div>
    </div>
  );
}

function NewPatientForm({ onCreated }: { onCreated: (patient: PatientRecord) => void }) {
  const ids = { name: useId(), dob: useId(), contact: useId(), heading: useId() };
  const [name, setName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [contact, setContact] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const canSubmit = name.trim() !== "" && dateOfBirth !== "" && !saving;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    const input: NewPatient = { name: name.trim(), dateOfBirth };
    if (contact.trim()) input.contact = contact.trim();
    try {
      const created = await createPatient(input);
      setName("");
      setDateOfBirth("");
      setContact("");
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <form className="patients-form" aria-labelledby={ids.heading} onSubmit={onSubmit}>
      <h2 id={ids.heading}>Add a patient</h2>
      <label htmlFor={ids.name}>Name</label>
      <input
        id={ids.name}
        className="patients-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="off"
        required
      />
      <label htmlFor={ids.dob}>Date of birth</label>
      <input
        id={ids.dob}
        className="patients-input"
        type="date"
        value={dateOfBirth}
        onChange={(e) => setDateOfBirth(e.target.value)}
        required
      />
      <label htmlFor={ids.contact}>Contact (optional)</label>
      <input
        id={ids.contact}
        className="patients-input"
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        autoComplete="off"
      />
      <button type="submit" className="filter-bar__button" disabled={!canSubmit}>
        {saving ? "Adding..." : "Add patient"}
      </button>
      {error && <p className="error-text">Could not add the patient: {error}</p>}
    </form>
  );
}

function PatientDetail({ patient, onErased }: { patient: PatientRecord; onErased: () => void }) {
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSessions(null);
    setError(null);
    listPatientSessions(patient.id)
      .then((result) => {
        if (!cancelled) setSessions(result);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [patient.id]);

  return (
    <div>
      <h2>{patient.name}</h2>
      <dl className="session-facts">
        <dt>Date of birth</dt>
        <dd>{patient.dateOfBirth}</dd>
        <dt>Contact</dt>
        <dd>{patient.contact || "Not given"}</dd>
      </dl>

      <EraseControl patient={patient} sessionCount={sessions?.length ?? null} onErased={onErased} />

      <h3>Linked sessions</h3>
      {error && <p className="error-text">Could not load linked sessions: {error}</p>}
      {!error && sessions === null && <p>Loading...</p>}
      {sessions !== null && sessions.length === 0 && <p>No sessions are linked to this patient yet.</p>}
      {sessions !== null && sessions.length > 0 && (
        <table className="session-table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Protocol</th>
              <th>Session state</th>
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
                <td>
                  <SafetyStateBadge state={session.state} />
                </td>
                <td>{new Date(session.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Permanent erasure of a patient and everything recorded under their visit codes. The server
 * only proceeds when the patient's exact name is typed, and refuses a patient with
 * adverse-event records; both outcomes are shown here as the server words them.
 */
function EraseControl({
  patient,
  sessionCount,
  onErased,
}: {
  patient: PatientRecord;
  sessionCount: number | null;
  onErased: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const matches = typed.trim().toLowerCase() === patient.name.trim().toLowerCase();

  async function confirm() {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await erasePatient(patient.id, typed);
      setOpen(false);
      onErased();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not erase the patient.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="report-actions">
        <button type="button" className="report-button report-button--danger" onClick={() => setOpen(true)}>
          Erase patient…
        </button>
      </p>
      {open && (
        <div className="report-dialog-backdrop" role="presentation">
          <div className="report-dialog" role="dialog" aria-modal="true" aria-labelledby={`${inputId}-title`}>
            <h2 id={`${inputId}-title`}>Erase {patient.name}?</h2>
            <p>
              This permanently deletes the patient, {sessionCount === null ? "all" : sessionCount} linked
              {sessionCount === 1 ? " session" : " sessions"}, and every recording, measurement, report and
              consent signature recorded for them. It cannot be undone.
            </p>
            <label htmlFor={inputId} className="report-dialog__label">
              Type <strong>{patient.name}</strong> to confirm
            </label>
            <input
              id={inputId}
              className="patients-input"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoFocus
              autoComplete="off"
            />
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            <div className="report-actions">
              <button type="button" className="report-button report-button--danger-solid" disabled={!matches || busy} onClick={confirm}>
                {busy ? "Erasing..." : "Erase permanently"}
              </button>
              <button
                type="button"
                className="report-button"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  setTyped("");
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

