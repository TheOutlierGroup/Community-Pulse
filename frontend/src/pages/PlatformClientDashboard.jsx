import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import Layout from '../components/shared/Layout.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import {
  Activity,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Circle,
  ClipboardList,
  KeyRound,
  MailPlus,
  Trash2,
  Users,
} from 'lucide-react';

function normalizeSettings(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  return {};
}

function sessionStatusLabel(s) {
  if (s === 'active') return 'Active';
  if (s === 'closed') return 'Closed';
  return 'Draft';
}

export default function PlatformClientDashboard() {
  const { orgId } = useParams();
  const { user, logout, loading } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);

  const [notFound, setNotFound] = useState(false);
  const [org, setOrg] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [orgUsers, setOrgUsers] = useState([]);
  const [editName, setEditName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('employee');
  const [pwByUser, setPwByUser] = useState({});
  const [taskTitle, setTaskTitle] = useState('');
  const [taskBody, setTaskBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [pulseBusy, setPulseBusy] = useState(false);
  const [error, setError] = useState('');

  const loadDashboard = useCallback(async () => {
    const { data: orgRes } = await api.get(`/api/platform/organizations/${orgId}`);
    setOrg(orgRes.organization);
    setEditName(orgRes.organization?.name ?? '');
    const [tasksRes, sessionsRes, usersRes] = await Promise.all([
      api.get(`/api/platform/organizations/${orgId}/tasks`),
      api.get(`/api/platform/organizations/${orgId}/pulse-sessions`),
      api.get(`/api/platform/organizations/${orgId}/users`),
    ]);
    setTasks(tasksRes.data.tasks || []);
    setSessions(sessionsRes.data.sessions || []);
    setOrgUsers(usersRes.data.users || []);
    setNotFound(false);
  }, [orgId]);

  useEffect(() => {
    if (!ok || !orgId) return;
    (async () => {
      try {
        setError('');
        await loadDashboard();
      } catch (e) {
        if (e.response?.status === 404) {
          setNotFound(true);
          setOrg(null);
        } else {
          setError(e.response?.data?.error || 'Failed to load client.');
        }
      }
    })();
  }, [ok, orgId, loadDashboard]);

  const settings = normalizeSettings(org?.settings);
  const pulseEnabled = settings.pulseEnabled === true;

  async function saveOrgName(e) {
    e.preventDefault();
    if (!orgId) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/organizations/${orgId}`, { name: editName.trim() });
      await loadDashboard();
      showToast('Company name saved.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update company.');
    } finally {
      setBusy(false);
    }
  }

  async function togglePulse(next) {
    if (!orgId || !org) return;
    setPulseBusy(true);
    setError('');
    try {
      const nextSettings = { ...normalizeSettings(org.settings), pulseEnabled: next };
      const { data } = await api.patch(`/api/platform/organizations/${orgId}`, {
        settings: nextSettings,
      });
      setOrg(data);
      showToast(next ? 'Pulse is on for this client.' : 'Pulse is off for this client.', {
        variant: 'success',
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update Pulse setting.');
    } finally {
      setPulseBusy(false);
    }
  }

  async function sendOrgInvite(e) {
    e.preventDefault();
    if (!orgId) return;
    setBusy(true);
    setError('');
    try {
      const invitedTo = inviteEmail.trim();
      const { data } = await api.post(`/api/platform/organizations/${orgId}/invites`, {
        email: invitedTo,
        invitedRole: inviteRole,
      });
      const fullInvite = `${window.location.origin}${data.inviteUrl}`;
      setInviteEmail('');
      showToast(`Invite link for ${invitedTo}:\n\n${fullInvite}`, {
        variant: 'success',
        durationMs: 20000,
      });
      await loadDashboard();
    } catch (err) {
      setError(err.response?.data?.error || 'Invite failed.');
    } finally {
      setBusy(false);
    }
  }

  async function setPassword(userId) {
    const password = pwByUser[userId];
    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/users/${userId}/password`, { password });
      setPwByUser((prev) => ({ ...prev, [userId]: '' }));
      showToast('Password updated.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Password update failed.');
    } finally {
      setBusy(false);
    }
  }

  async function addTask(e) {
    e.preventDefault();
    if (!orgId || !taskTitle.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/platform/organizations/${orgId}/tasks`, {
        title: taskTitle.trim(),
        body: taskBody.trim(),
      });
      setTaskTitle('');
      setTaskBody('');
      await loadDashboard();
      showToast('Task added.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add task.');
    } finally {
      setBusy(false);
    }
  }

  async function setTaskStatus(taskId, status) {
    if (!orgId) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/organizations/${orgId}/tasks/${taskId}`, { status });
      await loadDashboard();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update task.');
    } finally {
      setBusy(false);
    }
  }

  async function removeTask(taskId) {
    if (!orgId) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/api/platform/organizations/${orgId}/tasks/${taskId}`);
      await loadDashboard();
      showToast('Task removed.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove task.');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !ok) return null;

  if (notFound) {
    return (
      <Layout user={user} onLogout={logout}>
        <p className="error">Client not found.</p>
        <Link to="/platform/clients" className="btn btn-ghost" style={{ marginTop: '1rem' }}>
          <ArrowLeft size={18} aria-hidden />
          Back to clients
        </Link>
      </Layout>
    );
  }

  if (!org) {
    return (
      <Layout user={user} onLogout={logout}>
        {error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}
      </Layout>
    );
  }

  const activeSession = sessions.find((s) => s.status === 'active');

  return (
    <Layout user={user} onLogout={logout}>
      <div className="page-header-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <Link
            to="/platform/clients"
            className="btn btn-ghost platform-back-link"
            style={{ marginBottom: '0.75rem', paddingLeft: 0 }}
          >
            <ArrowLeft size={18} aria-hidden />
            Clients
          </Link>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <Building2 size={28} strokeWidth={1.75} aria-hidden />
            {org.name}
          </h1>
          <p className="muted" style={{ marginTop: '0.35rem', marginBottom: 0 }}>
            Project workspace, internal tasks, and Pulse for this client.
          </p>
        </div>
      </div>

      {error && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}

      <div className="platform-client-dashboard-grid">
        <div className="card platform-client-dashboard__card">
          <h2 className="platform-client-dashboard__h2">Company</h2>
          <form onSubmit={saveOrgName}>
            <div className="field">
              <label htmlFor="dash-ename">Company name</label>
              <input
                id="dash-ename"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-ghost" disabled={busy}>
              Save name
            </button>
          </form>
          <p className="muted" style={{ marginTop: '1rem', fontSize: '0.85rem', marginBottom: 0 }}>
            Created{' '}
            {org.created_at
              ? new Date(org.created_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })
              : '—'}
          </p>
        </div>

        <div className="card platform-client-dashboard__card">
          <h2 className="platform-client-dashboard__h2" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ClipboardList size={22} strokeWidth={1.75} aria-hidden />
            Internal tasks
          </h2>
          <p className="muted" style={{ fontSize: '0.9rem', marginTop: 0 }}>
            Work items for your platform team (not visible to the client).
          </p>
          <form onSubmit={addTask} className="platform-task-form">
            <div className="field">
              <label htmlFor="task-title">Title</label>
              <input
                id="task-title"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="e.g. Kickoff questionnaire"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="task-body">Notes (optional)</label>
              <textarea
                id="task-body"
                value={taskBody}
                onChange={(e) => setTaskBody(e.target.value)}
                rows={3}
                placeholder="Details, links, or checklist items"
                className="platform-textarea"
              />
            </div>
            <button type="submit" className="btn btn-primary platform-inline-primary" disabled={busy}>
              Add task
            </button>
          </form>
          {!tasks.length && <p className="muted" style={{ marginTop: '1rem' }}>No tasks yet.</p>}
          {tasks.length > 0 && (
            <ul className="platform-task-list">
              {tasks.map((t) => (
                <li key={t.id} className={`platform-task-list__item platform-task-list__item--${t.status}`}>
                  <div className="platform-task-list__main">
                    <button
                      type="button"
                      className="platform-task-list__toggle"
                      onClick={() => setTaskStatus(t.id, t.status === 'done' ? 'open' : 'done')}
                      disabled={busy}
                      aria-label={t.status === 'done' ? 'Mark open' : 'Mark done'}
                    >
                      {t.status === 'done' ? (
                        <CheckCircle2 size={22} className="platform-task-list__check" aria-hidden />
                      ) : (
                        <Circle size={22} strokeWidth={1.75} aria-hidden />
                      )}
                    </button>
                    <div>
                      <div className="platform-task-list__title">{t.title}</div>
                      {t.body ? <p className="platform-task-list__body muted">{t.body}</p> : null}
                      <p className="platform-task-list__meta muted">
                        {t.createdByEmail ? `Added by ${t.createdByEmail}` : 'Added'}{' · '}
                        {t.createdAt
                          ? new Date(t.createdAt).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })
                          : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost platform-task-list__delete"
                    onClick={() => removeTask(t.id)}
                    disabled={busy}
                    aria-label="Delete task"
                  >
                    <Trash2 size={18} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card platform-client-dashboard__card platform-client-dashboard__card--wide">
          <h2 className="platform-client-dashboard__h2" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={22} strokeWidth={1.75} aria-hidden />
            Pulse
          </h2>
          <p className="muted" style={{ fontSize: '0.9rem', marginTop: 0 }}>
            When Pulse is on, this client&apos;s admins can run employee pulse sessions in their dashboard.
            Employees only see Pulse when there is an active session.
          </p>
          <div className="platform-pulse-toggle-row">
            <label className="platform-toggle">
              <input
                type="checkbox"
                checked={pulseEnabled}
                disabled={pulseBusy}
                onChange={(e) => togglePulse(e.target.checked)}
              />
              <span className="platform-toggle__slider" aria-hidden />
              <span className="platform-toggle__label">Pulse enabled for this client</span>
            </label>
          </div>
          <div className="platform-pulse-summary">
            <div>
              <span className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Active session
              </span>
              <p style={{ margin: '0.25rem 0 0', fontWeight: 600 }}>
                {activeSession ? activeSession.name : 'None'}
              </p>
            </div>
            <div>
              <span className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Total sessions
              </span>
              <p style={{ margin: '0.25rem 0 0', fontWeight: 600 }}>{sessions.length}</p>
            </div>
          </div>
          {sessions.length > 0 && (
            <div className="table-wrap" style={{ marginTop: '1rem' }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">Session</th>
                    <th scope="col">Status</th>
                    <th scope="col">Created</th>
                    <th scope="col">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>
                        <span className={`badge badge-${s.status === 'active' ? 'active' : s.status === 'closed' ? 'closed' : 'draft'}`}>
                          {sessionStatusLabel(s.status)}
                        </span>
                      </td>
                      <td className="muted" style={{ fontSize: '0.85rem' }}>
                        {s.createdAt
                          ? new Date(s.createdAt).toLocaleDateString(undefined, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })
                          : '—'}
                      </td>
                      <td className="muted" style={{ fontSize: '0.85rem' }}>
                        {s.closedAt
                          ? new Date(s.closedAt).toLocaleDateString(undefined, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card platform-client-dashboard__card platform-client-dashboard__card--wide">
          <h2 className="platform-client-dashboard__h2" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <MailPlus size={22} strokeWidth={1.75} aria-hidden />
            Invite user
          </h2>
          <form onSubmit={sendOrgInvite} className="grid-2" style={{ alignItems: 'end' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="dash-iemail">Email</label>
              <input
                id="dash-iemail"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="dash-irole">Role</label>
              <select
                id="dash-irole"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                style={{ minHeight: 44, borderRadius: 10, padding: '0.5rem 0.75rem' }}
              >
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <button type="submit" className="btn btn-primary platform-inline-primary" disabled={busy}>
                Create invite
              </button>
            </div>
          </form>
        </div>

        <div className="card platform-client-dashboard__card platform-client-dashboard__card--wide">
          <h2 className="platform-client-dashboard__h2" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Users size={22} strokeWidth={1.75} aria-hidden />
            Users
          </h2>
          {!orgUsers.length && <p className="muted">No users yet.</p>}
          {orgUsers.length > 0 && (
            <div className="table-wrap">
              <table className="admin-table platform-clients-users-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>New password</th>
                  </tr>
                </thead>
                <tbody>
                  {orgUsers.map((u) => (
                    <tr key={u.id}>
                      <td>{u.email}</td>
                      <td>
                        <span className={`badge badge-${u.role === 'admin' ? 'active' : 'draft'}`}>
                          {u.role}
                        </span>
                      </td>
                      <td>
                        <div className="platform-users-table__pw">
                          <input
                            type="password"
                            autoComplete="new-password"
                            placeholder="Min 8 chars"
                            value={pwByUser[u.id] || ''}
                            onChange={(e) =>
                              setPwByUser((prev) => ({ ...prev, [u.id]: e.target.value }))
                            }
                            aria-label={`New password for ${u.email}`}
                          />
                          <button
                            type="button"
                            className="btn btn-ghost platform-users-table__pw-btn"
                            disabled={busy}
                            onClick={() => setPassword(u.id)}
                          >
                            <KeyRound size={16} aria-hidden />
                            Set
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
