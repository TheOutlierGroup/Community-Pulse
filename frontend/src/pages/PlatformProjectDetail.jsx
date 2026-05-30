import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, List, Kanban, Clock, Check, X } from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import Layout from '../components/shared/Layout.jsx';
import '../styles/crm.css';

const STATUS_OPTIONS = ['planning', 'active', 'on_hold', 'completed', 'archived'];
const TASK_STATUSES = ['todo', 'in_progress', 'done'];

const STATUS_BADGE = {
  planning: 'badge badge-planning',
  active: 'badge badge-active-proj',
  on_hold: 'badge badge-on-hold',
  completed: 'badge badge-completed',
  archived: 'badge badge-archived',
};

function fmt(n) {
  if (n == null || n === '') return '—';
  return Number(n).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function BudgetPanel({ project }) {
  const baseline = Number(project.baselineCost || 0);
  const actual = Number(project.actualCost || 0);
  const baselineHrs = Number(project.baselineHours || 0);
  const actualHrs = Number(project.actualHours || 0);
  const over = baseline > 0 && actual > baseline;
  const pct = baseline > 0 ? Math.min((actual / baseline) * 100, 100) : 0;

  return (
    <div className="budget-panel">
      <div className="budget-panel__title">Budget</div>
      <div className="budget-row">
        <span className="budget-row__label">Baseline hours</span>
        <span className="budget-row__value">{baselineHrs ? `${baselineHrs}h` : '—'}</span>
      </div>
      <div className="budget-row">
        <span className="budget-row__label">Actual hours</span>
        <span className="budget-row__value">{actualHrs ? `${actualHrs}h` : '0h'}</span>
      </div>
      <div className="budget-row">
        <span className="budget-row__label">Baseline cost</span>
        <span className="budget-row__value">{fmt(baseline || null)}</span>
      </div>
      <div className="budget-row">
        <span className="budget-row__label">Actual cost</span>
        <span className={`budget-row__value ${over ? 'budget-row__value--over' : baseline > 0 ? 'budget-row__value--ok' : ''}`}>
          {fmt(actual || null)}
        </span>
      </div>
      {baseline > 0 && (
        <div className="budget-bar">
          <div className={`budget-bar__fill ${over ? 'budget-bar__fill--over' : ''}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function TaskCard({ task }) {
  return (
    <div className="lead-card">
      <div className="lead-card__title">{task.title}</div>
      {task.assigneeName && <div className="lead-card__meta"><span>{task.assigneeName}</span></div>}
    </div>
  );
}

export default function PlatformProjectDetail() {
  const { projectId } = useParams();
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const { showToast } = useToast();

  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [timeLogs, setTimeLogs] = useState([]);
  const [activity, setActivity] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [view, setView] = useState('kanban');

  // Time log form
  const [addingLog, setAddingLog] = useState(false);
  const [logForm, setLogForm] = useState({ description: '', hours: '', costRate: '', loggedDate: new Date().toISOString().slice(0, 10) });
  const [logBusy, setLogBusy] = useState(false);

  // Status update
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useDocumentTitle(!loading && ok && project ? `${project.name} | ${DEFAULT_TAB}` : null);

  const loadProject = useCallback(async () => {
    setFetching(true);
    try {
      const [projRes, taskRes, logRes, actRes] = await Promise.all([
        api.get(`/api/platform/projects/${projectId}`),
        api.get(`/api/platform/projects/${projectId}/tasks`),
        api.get(`/api/platform/projects/${projectId}/time-logs`),
        api.get(`/api/platform/projects/${projectId}/activity`),
      ]);
      setProject(projRes.data.project);
      setTasks(taskRes.data.tasks || []);
      setTimeLogs(logRes.data.timeLogs || []);
      setActivity(actRes.data.activity || []);
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to load project.', 'error');
    } finally {
      setFetching(false);
    }
  }, [projectId, showToast]);

  useEffect(() => {
    if (!ok) return;
    loadProject();
  }, [ok, loadProject]);

  async function updateStatus(newStatus) {
    setUpdatingStatus(true);
    try {
      await api.patch(`/api/platform/projects/${projectId}`, { status: newStatus });
      setProject((p) => ({ ...p, status: newStatus }));
      showToast('Status updated.', 'success');
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to update status.', 'error');
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function addTimeLog(e) {
    e.preventDefault();
    if (!logForm.hours) return;
    setLogBusy(true);
    try {
      await api.post(`/api/platform/projects/${projectId}/time-logs`, {
        description: logForm.description,
        hours: parseFloat(logForm.hours),
        costRate: logForm.costRate ? parseFloat(logForm.costRate) : undefined,
        loggedDate: logForm.loggedDate,
      });
      showToast('Time logged.', 'success');
      setLogForm({ description: '', hours: '', costRate: '', loggedDate: new Date().toISOString().slice(0, 10) });
      setAddingLog(false);
      loadProject();
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to log time.', 'error');
    } finally {
      setLogBusy(false);
    }
  }

  async function deleteTimeLog(logId) {
    try {
      await api.delete(`/api/platform/projects/${projectId}/time-logs/${logId}`);
      showToast('Entry removed.', 'success');
      loadProject();
    } catch {
      showToast('Failed to remove entry.', 'error');
    }
  }

  const tasksByStatus = TASK_STATUSES.reduce((acc, s) => {
    acc[s] = tasks.filter((t) => t.status === s);
    return acc;
  }, {});

  if (!ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <div className="app-main">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" style={{ padding: '0.4rem 0.7rem' }} onClick={() => navigate('/platform/crm/projects')}>
            <ArrowLeft size={16} strokeWidth={2} aria-hidden />
          </button>
          {project && (
            <>
              <h1 style={{ margin: 0, flex: 1 }}>{project.name}</h1>
              <span className={STATUS_BADGE[project.status] || 'badge'}>{project.status?.replace('_', ' ')}</span>
              <select
                value={project.status}
                onChange={(e) => updateStatus(e.target.value)}
                disabled={updatingStatus}
                style={{ fontSize: '0.875rem', padding: '0.4rem 0.7rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
              >
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </>
          )}
        </div>

        {fetching && <p className="muted">Loading…</p>}

        {project && (
          <div className="project-layout">
            {/* Main: tasks */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Tasks</h2>
                <div className="view-toggle">
                  <button className={`view-toggle__btn ${view === 'kanban' ? 'view-toggle__btn--active' : ''}`} onClick={() => setView('kanban')}>
                    <Kanban size={14} /> Kanban
                  </button>
                  <button className={`view-toggle__btn ${view === 'list' ? 'view-toggle__btn--active' : ''}`} onClick={() => setView('list')}>
                    <List size={14} /> List
                  </button>
                </div>
              </div>

              {view === 'kanban' ? (
                <div className="pipeline-board">
                  {TASK_STATUSES.map((s) => (
                    <div key={s} className="pipeline-col">
                      <div className="pipeline-col__header">
                        <span className="pipeline-col__title">{s.replace('_', ' ')}</span>
                        <span className="pipeline-col__count">{tasksByStatus[s].length}</span>
                      </div>
                      <div className="pipeline-col__body">
                        {tasksByStatus[s].length === 0 && <p style={{ fontSize: '0.8rem', color: 'var(--muted)', textAlign: 'center', margin: '1rem 0' }}>No tasks</p>}
                        {tasksByStatus[s].map((t) => <TaskCard key={t.id} task={t} />)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="platform-users-table">
                    <thead><tr><th>Task</th><th>Status</th><th>Assignee</th></tr></thead>
                    <tbody>
                      {tasks.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--muted)', padding: '1.5rem' }}>No tasks yet.</td></tr>}
                      {tasks.map((t) => (
                        <tr key={t.id}>
                          <td>{t.title}</td>
                          <td><span className="badge">{t.status.replace('_', ' ')}</span></td>
                          <td style={{ color: 'var(--muted)' }}>{t.assigneeName || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <BudgetPanel project={project} />

              {/* Time logs */}
              <div className="budget-panel">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <div className="budget-panel__title" style={{ marginBottom: 0 }}>Time Logs</div>
                  <button className="btn btn-ghost" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }} onClick={() => setAddingLog((v) => !v)}>
                    {addingLog ? <X size={13} /> : <Plus size={13} />}
                    {addingLog ? 'Cancel' : 'Add'}
                  </button>
                </div>

                {addingLog && (
                  <form onSubmit={addTimeLog} style={{ marginBottom: '1rem', background: 'var(--surface2)', borderRadius: 8, padding: '0.85rem' }}>
                    <div className="field" style={{ marginBottom: '0.6rem' }}>
                      <label style={{ fontSize: '0.8rem' }}>Description</label>
                      <input value={logForm.description} onChange={(e) => setLogForm((p) => ({ ...p, description: e.target.value }))} placeholder="What did you work on?" />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.6rem' }}>
                      <div className="field">
                        <label style={{ fontSize: '0.8rem' }}>Hours *</label>
                        <input type="number" min="0.25" step="0.25" value={logForm.hours} onChange={(e) => setLogForm((p) => ({ ...p, hours: e.target.value }))} required />
                      </div>
                      <div className="field">
                        <label style={{ fontSize: '0.8rem' }}>Rate ($/hr)</label>
                        <input type="number" min="0" step="1" value={logForm.costRate} onChange={(e) => setLogForm((p) => ({ ...p, costRate: e.target.value }))} />
                      </div>
                    </div>
                    <div className="field" style={{ marginBottom: '0.75rem' }}>
                      <label style={{ fontSize: '0.8rem' }}>Date</label>
                      <input type="date" value={logForm.loggedDate} onChange={(e) => setLogForm((p) => ({ ...p, loggedDate: e.target.value }))} />
                    </div>
                    <button className="btn btn-primary" type="submit" disabled={logBusy} style={{ width: '100%', fontSize: '0.85rem' }}>Save</button>
                  </form>
                )}

                <div className="time-log-list">
                  {timeLogs.length === 0 && <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>No time logged yet.</p>}
                  {timeLogs.map((l) => (
                    <div key={l.id} className="time-log-item">
                      <div className="time-log-item__left">
                        <div className="time-log-item__desc">{l.description || 'No description'}</div>
                        <div className="time-log-item__meta">{fmtDate(l.loggedDate)}{l.loggedByName ? ` · ${l.loggedByName}` : ''}</div>
                      </div>
                      <div className="time-log-item__right">
                        <div className="time-log-item__hours">{l.hours}h</div>
                        {l.costRate > 0 && <div className="time-log-item__cost">{fmt(l.hours * l.costRate)}</div>}
                      </div>
                      <button className="btn btn-ghost" style={{ padding: '0.25rem', alignSelf: 'center' }} onClick={() => deleteTimeLog(l.id)} aria-label="Remove">
                        <X size={13} strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Activity */}
              <div className="budget-panel">
                <div className="budget-panel__title">Activity</div>
                <div className="activity-feed">
                  {activity.length === 0 && <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>No activity yet.</p>}
                  {activity.map((a) => (
                    <div key={a.id} className="activity-item">
                      <div className="activity-item__dot" />
                      <div className="activity-item__body">
                        <div className="activity-item__text">{a.note}</div>
                        <div className="activity-item__time">{fmtDate(a.createdAt)}{a.actorName ? ` · ${a.actorName}` : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
