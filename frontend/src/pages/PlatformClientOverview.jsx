import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import api from '../services/api.js';
import PlatformClientHeader from './PlatformClientHeader.jsx';
import { ClipboardList, LayoutDashboard, CircleUser, Users } from 'lucide-react';

function getLocalWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const fmt = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { weekStart: fmt(monday), weekEnd: fmt(sunday) };
}

function formatWeekLabel(startStr, endStr) {
  try {
    const a = new Date(`${startStr}T12:00:00`);
    const b = new Date(`${endStr}T12:00:00`);
    const md = { month: 'short', day: 'numeric' };
    const mdy = { ...md, year: 'numeric' };
    if (a.getFullYear() === b.getFullYear()) {
      return `${a.toLocaleDateString(undefined, md)} – ${b.toLocaleDateString(undefined, mdy)}`;
    }
    return `${a.toLocaleDateString(undefined, mdy)} – ${b.toLocaleDateString(undefined, mdy)}`;
  } catch {
    return `${startStr} – ${endStr}`;
  }
}

function statusBadgeClass(status) {
  if (status === 'completed') return 'closed';
  if (status === 'working' || status === 'review') return 'active';
  return 'draft';
}

const STATUS_LABEL = {
  todo: 'To do',
  working: 'Working on',
  review: 'Review',
  completed: 'Completed',
};

function assigneeLabel(a) {
  if (!a) return '—';
  const n = [a.firstName, a.lastName].filter(Boolean).join(' ').trim();
  return n || a.email || '—';
}

export default function PlatformClientOverview() {
  const { org, orgId, clientLogoUrl } = useOutletContext();
  const week = useMemo(() => getLocalWeekRange(), []);
  const [dash, setDash] = useState(null);
  const [dashError, setDashError] = useState('');
  const [dashLoading, setDashLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setDashLoading(true);
    setDashError('');
    try {
      const { data } = await api.get(`/api/platform/organizations/${orgId}/dashboard`, {
        params: { weekStart: week.weekStart, weekEnd: week.weekEnd },
      });
      setDash(data);
    } catch (e) {
      setDash(null);
      setDashError(e.response?.data?.error || 'Could not load dashboard.');
    } finally {
      setDashLoading(false);
    }
  }, [orgId, week.weekStart, week.weekEnd]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const counts = dash?.taskCountsByStatus;

  return (
    <>
      <PlatformClientHeader orgName={org.name} logoSrc={clientLogoUrl} />
      {dashError && <p className="error" style={{ marginBottom: '1rem' }}>{dashError}</p>}
      <div className="platform-client-dashboard-grid">
        <div className="card platform-client-dashboard__card platform-client-dashboard__card--wide">
          <h2 className="platform-client-dashboard__h2" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <LayoutDashboard size={22} strokeWidth={1.75} aria-hidden />
            Dashboard
          </h2>
          <p className="muted" style={{ marginTop: '0.35rem', maxWidth: '40rem' }}>
            Overview for <strong>{org.name}</strong>. Company profile lives under Account; tasks on the board.
          </p>
          <div style={{ marginTop: '1rem' }}>
            <Link
              to={`/platform/clients/${orgId}/account`}
              className="btn btn-primary platform-inline-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <CircleUser size={20} strokeWidth={1.75} aria-hidden />
              Open Account
            </Link>
          </div>
        </div>

        <div className="card platform-client-dashboard__card platform-client-dashboard__card--wide">
          <h3 className="platform-client-dashboard__h2">Stats</h3>
          {dashLoading && <p className="muted">Loading stats…</p>}
          {!dashLoading && dash && (
            <div className="platform-client-stats">
              <div className="platform-client-stats__tile">
                <div className="platform-client-stats__icon" aria-hidden>
                  <Users size={22} strokeWidth={1.75} />
                </div>
                <div className="platform-client-stats__value">{dash.userCount}</div>
                <div className="platform-client-stats__label">Users</div>
              </div>
              <div className="platform-client-stats__tile">
                <div className="platform-client-stats__icon" aria-hidden>
                  <ClipboardList size={22} strokeWidth={1.75} />
                </div>
                <div className="platform-client-stats__value">{dash.totalTasks}</div>
                <div className="platform-client-stats__label">Tasks (all)</div>
              </div>
              {counts &&
                ['todo', 'working', 'review', 'completed'].map((key) => (
                  <div key={key} className="platform-client-stats__tile platform-client-stats__tile--status">
                    <div className="platform-client-stats__value">{counts[key] ?? 0}</div>
                    <div className="platform-client-stats__label">{STATUS_LABEL[key]}</div>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="card platform-client-dashboard__card platform-client-dashboard__card--wide">
          <div className="platform-client-dashboard__table-head">
            <h3 className="platform-client-dashboard__h2" style={{ margin: 0 }}>
              Tasks due this week
            </h3>
            <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
              {formatWeekLabel(week.weekStart, week.weekEnd)} ·{' '}
              <Link to={`/platform/clients/${orgId}/tasks`} className="platform-client-account__back-dash">
                Open task board
              </Link>
            </p>
          </div>
          {dashLoading && <p className="muted" style={{ marginTop: '1rem' }}>Loading…</p>}
          {!dashLoading && dash && dash.tasksDueThisWeek.length === 0 && (
            <p className="muted" style={{ marginTop: '1rem' }}>
              No tasks with a due date in this week.
            </p>
          )}
          {!dashLoading && dash && dash.tasksDueThisWeek.length > 0 && (
            <div className="table-wrap" style={{ marginTop: '1rem' }}>
              <table className="admin-table platform-client-dashboard__tasks-table">
                <thead>
                  <tr>
                    <th scope="col">Task</th>
                    <th scope="col">Due</th>
                    <th scope="col">Status</th>
                    <th scope="col">Assigned</th>
                  </tr>
                </thead>
                <tbody>
                  {dash.tasksDueThisWeek.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <Link
                          to={`/platform/clients/${orgId}/tasks?task=${encodeURIComponent(t.id)}`}
                          className="platform-client-dashboard__task-link"
                        >
                          {t.title}
                        </Link>
                      </td>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                        {t.dueDate
                          ? new Date(`${t.dueDate}T12:00:00`).toLocaleDateString(undefined, {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            })
                          : '—'}
                      </td>
                      <td>
                        <span className={`badge badge-${statusBadgeClass(t.status)}`}>
                          {STATUS_LABEL[t.status] || t.status}
                        </span>
                      </td>
                      <td className="muted">{assigneeLabel(t.assignedTo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
