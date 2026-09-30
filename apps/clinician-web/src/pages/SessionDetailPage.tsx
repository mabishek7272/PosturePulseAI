import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getExposureSummary, getSession, listEvents } from "../api/client";
import { connectToSession } from "../api/socket";
import type { EventRecord, ExposureSummary, SessionRecord } from "../api/types";
import { EventTimeline } from "../components/EventTimeline";
import { SafetyStateBadge } from "../components/SafetyStateBadge";

// Broadcast names the safety/policy/exposure/movement/symptom paths actually
// emit (services/backend-api/src/ws/session.gateway.ts callers). Deliberately
// excludes the high-frequency per-frame events (pose-landmark-frame,
// calibrated-joint-frame, camera-pose) - this dashboard is a clinician review
// surface, not a live pose viewer (that's apps/ios-client's job).
const REFRESH_ON_EVENTS = [
  "state",
  "decision-event",
  "symptom-report",
  "quality-gate-flag",
  "exposure-event",
  "movement-phase-event",
];

export function SessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [exposure, setExposure] = useState<ExposureSummary>({});
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const refreshRef = useRef<() => void>(() => {});

  const refresh = useCallback(() => {
    if (!sessionId) return;
    Promise.all([getSession(sessionId), listEvents(sessionId), getExposureSummary(sessionId)])
      .then(([sessionResult, eventsResult, exposureResult]) => {
        setSession(sessionResult);
        setEvents(eventsResult);
        setExposure(exposureResult);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [sessionId]);
  refreshRef.current = refresh;

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!sessionId) return;
    const socket = connectToSession(sessionId);
    socket.on("connect", () => setLive(true));
    socket.on("disconnect", () => setLive(false));
    for (const eventName of REFRESH_ON_EVENTS) {
      socket.on(eventName, () => refreshRef.current());
    }
    return () => {
      socket.disconnect();
    };
  }, [sessionId]);

  if (!sessionId) return <p>No session id in URL.</p>;
  if (error) return <p className="error-text">Could not load session: {error}</p>;
  if (!session) return <p>Loading...</p>;

  return (
    <div>
      <p>
        <Link to="/">&larr; Back to queue</Link>
      </p>
      <h1>
        {session.subjectPseudoId} <SafetyStateBadge state={session.state} />
        <span className={`live-indicator ${live ? "live-indicator--on" : ""}`}>{live ? "live" : "offline"}</span>
      </h1>
      <dl className="session-facts">
        <dt>Protocol</dt>
        <dd>
          {session.protocolId}@{session.protocolVersion}
        </dd>
        <dt>Deployment context</dt>
        <dd>{session.deploymentContext}</dd>
        <dt>Scale calibration</dt>
        <dd>{session.calibrationRef ?? "not calibrated (no metric measurement possible - docs/adr/008)"}</dd>
        <dt>Created</dt>
        <dd>{new Date(session.createdAt).toLocaleString()}</dd>
      </dl>

      <h2>Exposure summary</h2>
      <p className="page-caption">
        Valid seconds observed per posture bucket (TRD 2.1) - not an inferred tissue-load or dose
        estimate. Unsupported-quality time is excluded, never fabricated as bucket time.
      </p>
      {Object.keys(exposure).length === 0 ? (
        <p>No exposure data recorded yet.</p>
      ) : (
        <table className="session-table">
          <thead>
            <tr>
              <th>Posture bucket</th>
              <th>Valid seconds</th>
              <th>Total window seconds</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(exposure).map(([bucket, totals]) => (
              <tr key={bucket}>
                <td>{bucket}</td>
                <td>{totals.validSeconds.toFixed(1)}</td>
                <td>{totals.totalWindowSeconds.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Event timeline</h2>
      <EventTimeline events={events} />
    </div>
  );
}
