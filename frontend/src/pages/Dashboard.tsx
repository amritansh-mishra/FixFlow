import { useEffect, useState } from "react";
import { api, errorMessage, PRIORITIES, STATUSES, type Stats } from "../api";
import { useAuth } from "../auth";
import { ErrorBox, Spinner, statusLabel } from "../components/ui";

export function DashboardPage() {
  const { token } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ data: Stats }>("/api/stats", { token })
      .then(({ data }) => setStats(data))
      .catch((err) => setError(errorMessage(err)));
  }, [token]);

  if (error) return <div className="page"><ErrorBox message={error} /></div>;
  if (!stats) return <div className="page"><Spinner /></div>;

  const active = stats.byStatus.open + stats.byStatus.assigned + stats.byStatus.in_progress;
  const max = Math.max(1, ...STATUSES.map((s) => stats.byStatus[s]));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">How maintenance is going across your organization</p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Total tickets" value={stats.total} />
        <StatCard label="Needing action" value={active} />
        <StatCard label="Urgent" value={stats.byPriority.urgent} />
        <StatCard
          label="Avg. time to resolve"
          value={stats.averageResolutionHours === null ? "–" : `${stats.averageResolutionHours} h`}
        />
      </div>

      <div className="detail-grid">
        <section className="card">
          <h2>By status</h2>
          <ul className="bars">
            {STATUSES.map((s) => (
              <li key={s}>
                <span className="bar-label">{statusLabel(s)}</span>
                <span className="bar-track">
                  <span className={`bar-fill status-${s}`} style={{ width: `${(stats.byStatus[s] / max) * 100}%` }} />
                </span>
                <span className="bar-value">{stats.byStatus[s]}</span>
              </li>
            ))}
          </ul>
          <h2>By priority</h2>
          <div className="priority-row">
            {PRIORITIES.map((p) => (
              <div key={p} className={`priority-chip priority-${p}`}>
                <span>{p}</span>
                <strong>{stats.byPriority[p]}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Technician workload</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Technician</th>
                <th>Active</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {stats.technicians.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.active}</td>
                  <td>{t.completed}</td>
                </tr>
              ))}
              {stats.technicians.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">No technicians yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card stat-card">
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
