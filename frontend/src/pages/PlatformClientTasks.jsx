import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import api from '../services/api.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import PlatformClientHeader from './PlatformClientHeader.jsx';
import { CheckCircle2, Circle, ClipboardList, Trash2 } from 'lucide-react';

export default function PlatformClientTasks() {
  const { org, orgId, clientLogoUrl } = useOutletContext();
  const { showToast } = useToast();
  const [tasks, setTasks] = useState([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskBody, setTaskBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadTasks = useCallback(async () => {
    const { data } = await api.get(`/api/platform/organizations/${orgId}/tasks`);
    setTasks(data.tasks || []);
  }, [orgId]);

  useEffect(() => {
    loadTasks().catch(() => setTasks([]));
  }, [loadTasks]);

  async function addTask(e) {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/platform/organizations/${orgId}/tasks`, {
        title: taskTitle.trim(),
        body: taskBody.trim(),
      });
      setTaskTitle('');
      setTaskBody('');
      await loadTasks();
      showToast('Task added.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add task.');
    } finally {
      setBusy(false);
    }
  }

  async function setTaskStatus(taskId, status) {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/organizations/${orgId}/tasks/${taskId}`, { status });
      await loadTasks();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update task.');
    } finally {
      setBusy(false);
    }
  }

  async function removeTask(taskId) {
    setBusy(true);
    setError('');
    try {
      await api.delete(`/api/platform/organizations/${orgId}/tasks/${taskId}`);
      await loadTasks();
      showToast('Task removed.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove task.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PlatformClientHeader orgName={org.name} logoSrc={clientLogoUrl} />
      {error && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}
      <div className="platform-client-dashboard-grid">
        <div className="card platform-client-dashboard__card platform-client-dashboard__card--wide">
          <h2 className="platform-client-dashboard__h2" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ClipboardList size={22} strokeWidth={1.75} aria-hidden />
            Tasks
          </h2>
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
      </div>
    </>
  );
}
