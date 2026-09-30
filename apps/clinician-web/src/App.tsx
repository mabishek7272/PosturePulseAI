import { Link, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import { LogoutButton } from "./components/LogoutButton";
import { AdverseEventsPage } from "./pages/AdverseEventsPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { LoginPage } from "./pages/LoginPage";
import { PilotMetricsPage } from "./pages/PilotMetricsPage";
import { SessionDetailPage } from "./pages/SessionDetailPage";
import { SessionQueuePage } from "./pages/SessionQueuePage";

function HeaderNav() {
  const { token } = useAuth();
  if (!token) return null;
  return (
    <nav className="app-shell__nav">
      <Link to="/">Sessions</Link>
      <Link to="/pilot-metrics">Pilot monitoring</Link>
      <Link to="/adverse-events">Adverse events</Link>
      <Link to="/audit-log">Audit log</Link>
    </nav>
  );
}

/**
 * Clinician review surface for beAIve (TRD's "clinician review" requirement -
 * previously just a queryable API with no UI, per the Phase 2/3 plan's
 * deferred list). Read-only: this app never writes to a session - all
 * mutating actions (clinician-approved resume, escalation) remain
 * API-only/future work. Its REST calls require clinician login
 * (docs/adr/010-clinician-authentication.md); see README.md and
 * docs/adr/009-clinician-web-trust-model.md for what that login does and
 * doesn't cover (live WebSocket updates are not gated by it).
 */
export function App() {
  return (
    <AuthProvider>
      <div className="app-shell">
        <header className="app-shell__header">
          <h1 className="app-shell__title">beAIve clinician review</h1>
          <HeaderNav />
          <LogoutButton />
        </header>
        <main className="app-shell__main">
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <SessionQueuePage />
                </RequireAuth>
              }
            />
            <Route
              path="/sessions/:sessionId"
              element={
                <RequireAuth>
                  <SessionDetailPage />
                </RequireAuth>
              }
            />
            <Route
              path="/audit-log"
              element={
                <RequireAuth>
                  <AuditLogPage />
                </RequireAuth>
              }
            />
            <Route
              path="/pilot-metrics"
              element={
                <RequireAuth>
                  <PilotMetricsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/adverse-events"
              element={
                <RequireAuth>
                  <AdverseEventsPage />
                </RequireAuth>
              }
            />
          </Routes>
        </main>
      </div>
    </AuthProvider>
  );
}
