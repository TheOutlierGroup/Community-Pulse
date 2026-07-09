import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Check, Target } from 'lucide-react';
import api from '../services/api.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import RepositoryFiles from '../components/platform/RepositoryFiles.jsx';
import '../styles/crm.css';

const STAGES = ['New', 'Qualified', 'Meeting', 'Proposal'];

function fmtCurrency(n) {
  if (n === '' || n == null) return '—';
  const num = Number(n);
  if (Number.isNaN(num)) return '—';
  return num.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
}

function emptyCheckpointDraft() {
  return { expectedValue: '', financialGain: '', targetDate: '', notes: '' };
}

export default function PlatformProspectOpportunity() {
  const { orgId } = useOutletContext();
  const { showToast } = useToast();

  const [opportunity, setOpportunity] = useState(null);
  const [files, setFiles] = useState([]);
  const [fetching, setFetching] = useState(false);

  const [summaryDraft, setSummaryDraft] = useState('');
  const [progressDraft, setProgressDraft] = useState(0);
  const [savingOverview, setSavingOverview] = useState(false);
  const [savingStage, setSavingStage] = useState(false);

  const [checkpointDrafts, setCheckpointDrafts] = useState(() =>
    Object.fromEntries(STAGES.map((s) => [s, emptyCheckpointDraft()]))
  );
  const [savingStageRow, setSavingStageRow] = useState(null);

  const resourcePath = `/api/platform/crm/organisations/${orgId}/opportunity`;

  const loadAll = useCallback(async () => {
    setFetching(true);
    try {
      const { data } = await api.get(resourcePath);
      setOpportunity(data.opportunity);
      setFiles(data.files || []);
      setSummaryDraft(data.opportunity?.summary || '');
      setProgressDraft(data.opportunity?.progress_pct ?? 0);
      const drafts = Object.fromEntries(STAGES.map((s) => [s, emptyCheckpointDraft()]));
      for (const c of data.checkpoints || []) {
        drafts[c.stage] = {
          expectedValue: c.expected_value ?? '',
          financialGain: c.financial_gain ?? '',
          targetDate: c.target_date ? String(c.target_date).slice(0, 10) : '',
          notes: c.notes || '',
        };
      }
      setCheckpointDrafts(drafts);
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to load opportunity.', { variant: 'error' });
    } finally {
      setFetching(false);
    }
  }, [resourcePath, showToast]);

  useEffect(() => {
    if (orgId) loadAll();
  }, [orgId, loadAll]);

  async function setCurrentStage(stage) {
    if (stage === opportunity?.current_stage) return;
    setSavingStage(true);
    try {
      const { data } = await api.patch(resourcePath, { currentStage: stage });
      setOpportunity(data.opportunity);
      showToast(`Stage set to ${stage}.`, { variant: 'success' });
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to update stage.', { variant: 'error' });
    } finally {
      setSavingStage(false);
    }
  }

  async function saveOverview() {
    setSavingOverview(true);
    try {
      const { data } = await api.patch(resourcePath, {
        summary: summaryDraft,
        progressPct: progressDraft,
      });
      setOpportunity(data.opportunity);
      showToast('Opportunity updated.', { variant: 'success' });
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to update opportunity.', { variant: 'error' });
    } finally {
      setSavingOverview(false);
    }
  }

  function updateDraft(stage, field, value) {
    setCheckpointDrafts((prev) => ({ ...prev, [stage]: { ...prev[stage], [field]: value } }));
  }

  async function saveCheckpoint(stage) {
    setSavingStageRow(stage);
    try {
      const draft = checkpointDrafts[stage];
      await api.patch(`${resourcePath}/checkpoints/${stage}`, {
        expectedValue: draft.expectedValue === '' ? null : Number(draft.expectedValue),
        financialGain: draft.financialGain === '' ? null : Number(draft.financialGain),
        targetDate: draft.targetDate || null,
        notes: draft.notes || null,
      });
      showToast(`${stage} checkpoint saved.`, { variant: 'success' });
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to save checkpoint.', { variant: 'error' });
    } finally {
      setSavingStageRow(null);
    }
  }

  const totals = useMemo(() => {
    let expected = 0;
    let gain = 0;
    for (const stage of STAGES) {
      const d = checkpointDrafts[stage];
      expected += Number(d.expectedValue) || 0;
      gain += Number(d.financialGain) || 0;
    }
    return { expected, gain };
  }, [checkpointDrafts]);

  const currentStageIndex = STAGES.indexOf(opportunity?.current_stage || 'New');

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <Target size={26} strokeWidth={1.75} aria-hidden />
        <h1 style={{ margin: 0, flex: 1 }}>Opportunity</h1>
      </div>

      {fetching && !opportunity && <p className="muted">Loading…</p>}

      {opportunity && (
        <>
          <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
            <div className="budget-panel__title" style={{ marginBottom: '0.85rem' }}>Sales timeline — where are we?</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              {STAGES.map((stage, idx) => {
                const reached = idx <= currentStageIndex;
                const isCurrent = stage === opportunity.current_stage;
                return (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => setCurrentStage(stage)}
                    disabled={savingStage}
                    className="btn"
                    style={{
                      flex: 1,
                      minWidth: 110,
                      border: isCurrent ? '2px solid var(--accent, #2563eb)' : '1px solid var(--border)',
                      background: reached ? 'rgba(37,99,235,0.1)' : 'var(--surface)',
                      color: reached ? 'var(--accent, #2563eb)' : 'var(--muted)',
                      fontWeight: isCurrent ? 700 : 500,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    {isCurrent && <Check size={14} strokeWidth={2.5} aria-hidden />}
                    {stage}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="project-layout">
            <div>
              <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 700 }}>Checkpoints</h2>
              <div className="table-wrap">
                <table className="platform-users-table" style={{ minWidth: 620 }}>
                  <thead>
                    <tr>
                      <th>Stage</th>
                      <th>Expected value</th>
                      <th>Financial gain</th>
                      <th>Target date</th>
                      <th>Notes</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {STAGES.map((stage) => {
                      const draft = checkpointDrafts[stage];
                      return (
                        <tr key={stage}>
                          <td>
                            <span className={stage === opportunity.current_stage ? 'badge badge-active-proj' : 'badge'}>{stage}</span>
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={draft.expectedValue}
                              onChange={(e) => updateDraft(stage, 'expectedValue', e.target.value)}
                              style={{ width: '9ch' }}
                              placeholder="$"
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={draft.financialGain}
                              onChange={(e) => updateDraft(stage, 'financialGain', e.target.value)}
                              style={{ width: '9ch' }}
                              placeholder="$"
                            />
                          </td>
                          <td>
                            <input
                              type="date"
                              value={draft.targetDate}
                              onChange={(e) => updateDraft(stage, 'targetDate', e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              value={draft.notes}
                              onChange={(e) => updateDraft(stage, 'notes', e.target.value)}
                              placeholder="Notes"
                              style={{ minWidth: '10ch' }}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: '0.78rem', padding: '0.25rem 0.55rem' }}
                              onClick={() => saveCheckpoint(stage)}
                              disabled={savingStageRow === stage}
                            >
                              {savingStageRow === stage ? 'Saving…' : 'Save'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ fontWeight: 700 }}>Total</td>
                      <td style={{ fontWeight: 700 }}>{fmtCurrency(totals.expected)}</td>
                      <td style={{ fontWeight: 700 }}>{fmtCurrency(totals.gain)}</td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="budget-panel">
                <div className="budget-panel__title">Progress</div>
                <div className="progress-meter">
                  <div className="progress-meter__value">{progressDraft}%</div>
                  <div className="budget-bar" style={{ marginBottom: '0.85rem' }}>
                    <div className="budget-bar__fill" style={{ width: `${progressDraft}%` }} />
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={progressDraft}
                    onChange={(e) => setProgressDraft(Number(e.target.value))}
                    className="progress-meter__slider"
                  />
                </div>
                <div className="field" style={{ marginBottom: '0.75rem' }}>
                  <label style={{ fontSize: '0.8rem' }}>Summary</label>
                  <textarea
                    rows={3}
                    value={summaryDraft}
                    onChange={(e) => setSummaryDraft(e.target.value)}
                    placeholder="What's the opportunity here?"
                  />
                </div>
                <button className="btn btn-primary" onClick={saveOverview} disabled={savingOverview} style={{ width: '100%', fontSize: '0.85rem' }}>
                  {savingOverview ? 'Saving…' : 'Save'}
                </button>
              </div>

              <RepositoryFiles resourcePath={resourcePath} files={files} onChange={loadAll} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
