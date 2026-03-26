import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { CalendarRange, LayoutDashboard, ListTodo } from 'lucide-react';

const ClientTaskDetailPanel = lazy(() => import('../components/platform/ClientTaskDetailPanel.jsx'));

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

export default function PlatformHome() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const week = useMemo(() => getLocalWeekRange(), []);
  const [dash, setDash] = useState(null);
  const [dashLoading, setDashLoading] = useState(true);
  const [error, setError] = useState('');

  const [detailOrgId, setDetailOrgId] = useState(null);
  const [detailTaskId, setDetailTaskId] = useState(null);
  const [assignableUsers, setAssignableUsers] = useState([]);

  const load = useCallback(async () => {
    setError('');
    setDashLoading(true);
    try {
      const { data } = await api.get('/api/platform/me/tasks-dashboard', {
        params: { weekStart: week.weekStart, weekEnd: week.weekEnd },
      });
      setDash(data);
    } catch (e) {
      setDash(null);
      setError(e.response?.data?.error || 'Failed to load your tasks.');
    } finally {
      setDashLoading(false);
    }
  }, [week.weekStart, week.weekEnd]);

  useEffect(() => {
    if (ok) load();
  }, [ok, load]);

  const openTaskDetail = useCallback((organizationId, taskId) => {
    setDetailOrgId(organizationId);
    setDetailTaskId(taskId);
  }, []);

  const closeTaskDetail = useCallback(() => {
    setDetailOrgId(null);
    setDetailTaskId(null);
    setAssignableUsers([]);
  }, []);

  useEffect(() => {
    if (!detailOrgId) {
      setAssignableUsers([]);
      return undefined;
    }
    let cancelled = false;
    api
      .get(`/api/platform/organizations/${detailOrgId}/tasks/assignable-users`)
      .then(({ data }) => {
        if (!cancelled) setAssignableUsers(data.users || []);
      })
      .catch(() => {
        if (!cancelled) setAssignableUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [detailOrgId]);

  if (loading || !ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <LayoutDashboard size={28} strokeWidth={1.75} aria-hidden />
        Dashboard
      </h1>
      {error && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}

      <div className="platform-client-dashboard-grid">
        <div className="card platform-client-dashboard__card platform-client-dashboard__card--wide">
          <h2 className="platform-client-dashboard__h2" style={{ marginTop: 0 }}>
            Stats
          </h2>
          {dashLoading && <p className="muted">Loading…</p>}
          {!dashLoading && dash && (
            <div className="platform-client-stats">
              <div className="platform-client-stats__tile">
                <div className="platform-client-stats__icon" aria-hidden>
                  <CalendarRange size={22} strokeWidth={1.75} />
                </div>
                <div className="platform-client-stats__value">{dash.tasksDueThisWeekCount}</div>
                <div className="platform-client-stats__label">Due this week</div>
              </div>
              <div className="platform-client-stats__tile">
                <div className="platform-client-stats__icon" aria-hidden>
                  <ListTodo size={22} strokeWidth={1.75} />
                </div>
                <div className="platform-client-stats__value">{dash.openAssignedCount}</div>
                <div className="platform-client-stats__label">Open assigned to you</div>
              </div>
            </div>
          )}
        </div>

        <div className="card platform-client-dashboard__card platform-client-dashboard__card--wide">
          <div className="platform-client-dashboard__table-head">
            <h2 className="platform-client-dashboard__h2" style={{ margin: 0 }}>
              Due this week
            </h2>
            <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
              {formatWeekLabel(week.weekStart, week.weekEnd)}
            </p>
          </div>
          {dashLoading && <p className="muted" style={{ marginTop: '1rem' }}>Loading…</p>}
          {!dashLoading && dash && dash.tasksDueThisWeek.length === 0 && (
            <p className="muted" style={{ marginTop: '1rem' }}>
              No tasks assigned to you with a due date in this week.
            </p>
          )}
          {!dashLoading && dash && dash.tasksDueThisWeek.length > 0 && (
            <div className="table-wrap" style={{ marginTop: '1rem' }}>
              <table className="admin-table platform-client-dashboard__tasks-table">
                <thead>
                  <tr>
                    <th scope="col">Client</th>
                    <th scope="col">Task</th>
                    <th scope="col">Due</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dash.tasksDueThisWeek.map((t) => (
                    <tr
                      key={`${t.organizationId}-${t.id}`}
                      className="platform-dashboard-task-row platform-dashboard-task-row--clickable"
                      tabIndex={0}
                      role="button"
                      aria-label={`Open task: ${t.title}`}
                      onClick={() => openTaskDetail(t.organizationId, t.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openTaskDetail(t.organizationId, t.id);
                        }
                      }}
                    >
                      <td className="muted">{t.organizationName}</td>
                      <td>
                        <span className="platform-dashboard-task-row__title">{t.title}</span>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card platform-client-dashboard__card platform-client-dashboard__card--wide">
          <div className="platform-client-dashboard__table-head">
            <h2 className="platform-client-dashboard__h2" style={{ margin: 0 }}>
              Your assigned tasks
            </h2>
            <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
              Tasks across client companies where you are the assignee.
            </p>
          </div>
          {dashLoading && <p className="muted" style={{ marginTop: '1rem' }}>Loading…</p>}
          {!dashLoading && dash && dash.myTasks.length === 0 && (
            <p className="muted" style={{ marginTop: '1rem' }}>
              No tasks are assigned to you yet.
            </p>
          )}
          {!dashLoading && dash && dash.myTasks.length > 0 && (
            <div className="table-wrap" style={{ marginTop: '1rem' }}>
              <table className="admin-table platform-client-dashboard__tasks-table">
                <thead>
                  <tr>
                    <th scope="col">Client</th>
                    <th scope="col">Task</th>
                    <th scope="col">Due</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dash.myTasks.map((t) => (
                    <tr
                      key={`${t.organizationId}-${t.id}`}
                      className="platform-dashboard-task-row platform-dashboard-task-row--clickable"
                      tabIndex={0}
                      role="button"
                      aria-label={`Open task: ${t.title}`}
                      onClick={() => openTaskDetail(t.organizationId, t.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openTaskDetail(t.organizationId, t.id);
                        }
                      }}
                    >
                      <td className="muted">{t.organizationName}</td>
                      <td>
                        <span className="platform-dashboard-task-row__title">{t.title}</span>
                      </td>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                        {t.dueDate
                          ? new Date(`${t.dueDate}T12:00:00`).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })
                          : '—'}
                      </td>
                      <td>
                        <span className={`badge badge-${statusBadgeClass(t.status)}`}>
                          {STATUS_LABEL[t.status] || t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {detailOrgId && detailTaskId ? (
        <Suspense fallback={null}>
          <ClientTaskDetailPanel
            orgId={detailOrgId}
            taskId={detailTaskId}
            assignableUsers={assignableUsers}
            onClose={closeTaskDetail}
            onTasksChanged={load}
          />
        </Suspense>
      ) : null}
    </Layout>
  );
}
