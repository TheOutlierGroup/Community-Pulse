import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Briefcase, Check, Plus, Trash2, X } from 'lucide-react';
import api from '../services/api.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import RecentActivityPanel from '../components/platform/RecentActivityPanel.jsx';
import RepositoryFiles from '../components/platform/RepositoryFiles.jsx';
import '../styles/crm.css';

const MILESTONE_STATUSES = ['planned', 'in_progress', 'complete'];
const MILESTONE_BADGE = {
  planned: 'badge badge-planning',
  in_progress: 'badge badge-active-proj',
  complete: 'badge badge-completed',
};

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PlatformClientProjects() {
  const { orgId } = useOutletContext();
  const { showToast } = useToast();

  const [project, setProject] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [files, setFiles] = useState([]);
  const [fetching, setFetching] = useState(false);

  const [summaryDraft, setSummaryDraft] = useState('');
  const [progressDraft, setProgressDraft] = useState(0);
  const [savingOverview, setSavingOverview] = useState(false);

  const [addingMilestone, setAddingMilestone] = useState(false);
  const [milestoneForm, setMilestoneForm] = useState({ title: '', targetDate: '', status: 'planned', notes: '' });
  const [milestoneBusy, setMilestoneBusy] = useState(false);

  const resourcePath = `/api/platform/organizations/${orgId}/project`;

  const loadAll = useCallback(async () => {
    setFetching(true);
    try {
      const { data } = await api.get(resourcePath);
      setProject(data.project);
      setMilestones(data.milestones || []);
      setFiles(data.files || []);
      setSummaryDraft(data.project?.summary || '');
      setProgressDraft(data.project?.progress_pct ?? 0);
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to load project.', { variant: 'error' });
    } finally {
      setFetching(false);
    }
  }, [resourcePath, showToast]);

  useEffect(() => {
    if (orgId) loadAll();
  }, [orgId, loadAll]);

  async function saveOverview() {
    setSavingOverview(true);
    try {
      const { data } = await api.patch(resourcePath, {
        summary: summaryDraft,
        progressPct: progressDraft,
      });
      setProject(data.project);
      showToast('Project updated.', { variant: 'success' });
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to update project.', { variant: 'error' });
    } finally {
      setSavingOverview(false);
    }
  }

  async function addMilestone(e) {
    e.preventDefault();
    if (!milestoneForm.title.trim()) return;
    setMilestoneBusy(true);
    try {
      await api.post(`${resourcePath}/milestones`, {
        title: milestoneForm.title.trim(),
        targetDate: milestoneForm.targetDate || null,
        status: milestoneForm.status,
        notes: milestoneForm.notes || null,
      });
      setMilestoneForm({ title: '', targetDate: '', status: 'planned', notes: '' });
      setAddingMilestone(false);
      await loadAll();
      showToast('Milestone added.', { variant: 'success' });
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to add milestone.', { variant: 'error' });
    } finally {
      setMilestoneBusy(false);
    }
  }

  async function updateMilestoneStatus(milestone, status) {
    try {
      await api.patch(`${resourcePath}/milestones/${milestone.id}`, { status });
      await loadAll();
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to update milestone.', { variant: 'error' });
    }
  }

  async function deleteMilestone(milestone) {
    if (!window.confirm(`Delete milestone "${milestone.title}"?`)) return;
    try {
      await api.delete(`${resourcePath}/milestones/${milestone.id}`);
      await loadAll();
      showToast('Milestone removed.', { variant: 'success' });
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to delete milestone.', { variant: 'error' });
    }
  }

  return (
    <div className="app-main">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <Briefcase size={26} strokeWidth={1.75} aria-hidden />
        <h1 style={{ margin: 0, flex: 1 }}>Projects</h1>
      </div>

      {fetching && !project && <p className="muted">Loading…</p>}

      {project && (
        <div className="project-layout">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Timeline</h2>
              <button className="btn btn-ghost" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }} onClick={() => setAddingMilestone((v) => !v)}>
                {addingMilestone ? <X size={13} /> : <Plus size={13} />}
                {addingMilestone ? 'Cancel' : 'Add milestone'}
              </button>
            </div>

            {addingMilestone && (
              <form onSubmit={addMilestone} className="card" style={{ marginBottom: '1rem', padding: '0.85rem 1rem' }}>
                <div className="field" style={{ marginBottom: '0.6rem' }}>
                  <label>Title *</label>
                  <input
                    value={milestoneForm.title}
                    onChange={(e) => setMilestoneForm((p) => ({ ...p, title: e.target.value }))}
                    placeholder="e.g. Kickoff, Phase 1 complete"
                    required
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.6rem' }}>
                  <div className="field">
                    <label>Target date</label>
                    <input type="date" value={milestoneForm.targetDate} onChange={(e) => setMilestoneForm((p) => ({ ...p, targetDate: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>Status</label>
                    <select value={milestoneForm.status} onChange={(e) => setMilestoneForm((p) => ({ ...p, status: e.target.value }))}>
                      {MILESTONE_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                  </div>
                </div>
                <div className="field" style={{ marginBottom: '0.75rem' }}>
                  <label>Notes</label>
                  <input value={milestoneForm.notes} onChange={(e) => setMilestoneForm((p) => ({ ...p, notes: e.target.value }))} />
                </div>
                <button className="btn btn-primary" type="submit" disabled={milestoneBusy || !milestoneForm.title.trim()}>
                  {milestoneBusy ? 'Adding…' : 'Add milestone'}
                </button>
              </form>
            )}

            {milestones.length === 0 && !addingMilestone && (
              <p className="muted">No milestones yet. Add one to start the timeline.</p>
            )}

            {milestones.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.6rem' }}>
                {milestones.map((m) => (
                  <li key={m.id} className="card" style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <strong>{m.title}</strong>
                        <span className={MILESTONE_BADGE[m.status] || 'badge'}>{m.status.replace('_', ' ')}</span>
                      </div>
                      <div className="muted" style={{ fontSize: '0.82rem', marginTop: '0.2rem' }}>
                        {m.target_date ? fmtDate(m.target_date) : 'No target date'}
                        {m.notes ? ` · ${m.notes}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
                      <select
                        value={m.status}
                        onChange={(e) => updateMilestoneStatus(m, e.target.value)}
                        style={{ fontSize: '0.78rem', padding: '0.25rem 0.4rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                      >
                        {MILESTONE_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                      </select>
                      <button className="btn btn-ghost" style={{ padding: '0.3rem' }} onClick={() => deleteMilestone(m)} aria-label={`Delete ${m.title}`}>
                        <Trash2 size={14} strokeWidth={2} aria-hidden />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="budget-panel">
              <div className="budget-panel__title">Progress</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem' }}>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={progressDraft}
                  onChange={(e) => setProgressDraft(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontWeight: 700, minWidth: '3ch', textAlign: 'right' }}>{progressDraft}%</span>
              </div>
              <div className="budget-bar" style={{ marginBottom: '0.85rem' }}>
                <div className="budget-bar__fill" style={{ width: `${progressDraft}%` }} />
              </div>
              <div className="field" style={{ marginBottom: '0.75rem' }}>
                <label style={{ fontSize: '0.8rem' }}>Summary</label>
                <textarea
                  rows={3}
                  value={summaryDraft}
                  onChange={(e) => setSummaryDraft(e.target.value)}
                  placeholder="What's this engagement about?"
                />
              </div>
              <button className="btn btn-primary" onClick={saveOverview} disabled={savingOverview} style={{ width: '100%', fontSize: '0.85rem' }}>
                {savingOverview ? 'Saving…' : (
                  <>
                    <Check size={14} strokeWidth={2} aria-hidden style={{ marginRight: '0.3rem' }} />
                    Save
                  </>
                )}
              </button>
            </div>

            <RepositoryFiles resourcePath={resourcePath} files={files} onChange={loadAll} />

            <RecentActivityPanel orgId={orgId} resourcePath="/api/platform/organizations" style={{ marginBottom: 0 }} />
          </div>
        </div>
      )}
    </div>
  );
}
