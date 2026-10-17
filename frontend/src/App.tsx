import { isManager, useAuth } from "./auth";
import { DashboardPage } from "./pages/Dashboard";
import { LoginPage } from "./pages/Login";
import { TeamPage } from "./pages/Team";
import { TicketDetailPage } from "./pages/TicketDetail";
import { TicketsPage } from "./pages/Tickets";
import { useRoute } from "./router";

export function App() {
  const { user, logout } = useAuth();
  const route = useRoute();

  if (!user) return <LoginPage />;

  return (
    <>
      <header className="topbar">
        <a href="#/tickets" className="brand">
          <span className="brand-mark" aria-hidden="true">✓</span> FixFlow
        </a>
        <nav className="nav">
          <a href="#/tickets" className={route.name === "tickets" || route.name === "ticket" ? "active" : ""}>
            Tickets
          </a>
          {isManager(user) && (
            <a href="#/dashboard" className={route.name === "dashboard" ? "active" : ""}>
              Dashboard
            </a>
          )}
          {isManager(user) && (
            <a href="#/team" className={route.name === "team" ? "active" : ""}>
              Team
            </a>
          )}
        </nav>
        <div className="user-chip">
          <span>
            {user.name} <span className="muted small">· {user.role}</span>
          </span>
          <button className="button small" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>

      <main>
        {route.name === "ticket" && <TicketDetailPage key={route.id} id={route.id} />}
        {route.name === "dashboard" && (isManager(user) ? <DashboardPage /> : <TicketsPage />)}
        {route.name === "team" && (isManager(user) ? <TeamPage /> : <TicketsPage />)}
        {route.name === "tickets" && <TicketsPage />}
      </main>
    </>
  );
}
