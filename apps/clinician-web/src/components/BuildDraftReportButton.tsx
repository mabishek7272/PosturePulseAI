import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { buildDraftReport } from "../api/client";

/**
 * POST /sessions/:id/report builds the next draft version from the session's
 * latest metric results; the clinician is taken straight to it for review.
 */
export function BuildDraftReportButton({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function build() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBuilding(true);
    setError(null);
    try {
      const report = await buildDraftReport(sessionId);
      navigate(`/reports/${report.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      setBuilding(false);
    }
  }

  return (
    <div>
      <button type="button" className="filter-bar__button" onClick={build} disabled={building}>
        {building ? "Building draft report..." : "Build draft report"}
      </button>
      {error && <p className="error-text">Could not build the draft report: {error}</p>}
    </div>
  );
}
