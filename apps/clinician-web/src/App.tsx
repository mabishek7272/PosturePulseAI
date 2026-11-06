import { NavLink, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import { LogoutButton } from "./components/LogoutButton";
import { AdverseEventsPage } from "./pages/AdverseEventsPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { LoginPage } from "./pages/LoginPage";
import { PatientRegisterPage } from "./pages/PatientRegisterPage";
import { PilotMetricsPage } from "./pages/PilotMetricsPage";
import { ReportReviewPage } from "./pages/ReportReviewPage";
import { ReviewQueuePage } from "./pages/ReviewQueuePage";
import { SessionDetailPage } from "./pages/SessionDetailPage";
import { SessionQueuePage } from "./pages/SessionQueuePage";

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const NAV: { to: string; label: string; end?: boolean; icon: React.ReactNode }[] = [
  { to: "/", label: "Sessions", end: true, icon: icon("M4 5h16M4 12h16M4 19h10") },
  { to: "/reports", label: "Reports", icon: icon("M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6") },
  { to: "/patients", label: "Patients", icon: icon("M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-4A3.5 3.5 0 0 0 5 18.5V20M10.5 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 20v-1.2a3 3 0 0 0-2-2.8M15.5 5.2a3.2 3.2 0 0 1 0 6.2") },
  { to: "/pilot-metrics", label: "Pilot monitoring", icon: icon("M4 19V9M10 19V5M16 19v-7M22 19H2") },
  { to: "/adverse-events", label: "Adverse events", icon: icon("M12 3l9 16H3zM12 10v4M12 17h.01") },
  { to: "/audit-log", label: "Audit log", icon: icon("M12 8v4l3 2M21 12a9 9 0 1 1-3-6.7M21 4v5h-5") },
];

function Sidebar() {
  const { token } = useAuth();
  if (!token) return null;
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <img src={`${import.meta.env.BASE_URL}emblem.png`} alt="" width="44" height="38" />
        <div>
          <div className="sidebar__name">
            PosturePulse <span>Pro</span>
          </div>
          <div className="sidebar__tag">Clinician review</div>
        </div>
      </div>
      <nav className="sidebar__nav" aria-label="Main">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "navlink navlink--active" : "navlink")}>
            {n.icon}
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar__foot">
        <LogoutButton />
        <p>Draft measurements with stated uncertainty. Interpretation is the clinician&apos;s.</p>
      </div>
    </aside>
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
        <div className="app-shell__blobs" aria-hidden="true" />
        <Sidebar />
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
              path="/reports"
              element={
                <RequireAuth>
                  <ReviewQueuePage />
                </RequireAuth>
              }
            />
            <Route
              path="/reports/:reportId"
              element={
                <RequireAuth>
                  <ReportReviewPage />
                </RequireAuth>
              }
            />
            <Route
              path="/patients"
              element={
                <RequireAuth>
                  <PatientRegisterPage />
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
