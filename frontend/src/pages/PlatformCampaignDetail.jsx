import { Fragment, useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, X, Upload, Trash2, ChevronDown, ChevronRight, Users2, ArrowUpRight,
  GitBranch, Megaphone, FileQuestion, CheckCircle2,
} from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import Layout from '../components/shared/Layout.jsx';
import {
  campaignChannelLabel, campaignStatusLabel, campaignStatusBadgeClass, atlBtlLabel,
} from '../config/crmConstants.js';
import { parseCsv } from '../utils/contactImportCsv.js';
import { mapQuizRows, looksLikeQuiz, personaLabel, changeStateLabel, changeStateBadgeClass } from '../utils/quizCsv.js';
import '../styles/crm.css';

const TABS = [{ id: 'flow', label: 'Flow' }, { id: 'quiz', label: 'Quiz results' }];

// Columns hidden from the raw expander (already shown as primary fields).
const RAW_HIDDEN = new Set(['name', 'email', 'persona', 'change_state', 'ID', 'Timestamp', 'utm_source', 'utm_campaign', 'utm_medium', 'utm_content']);

export default function PlatformCampaignDetail() {
  const { id } = useParams();
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const { showToast } = useToast();
  const isAdmin = user?.role === 'admin';

  const [campaign, setCampaign] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [tab, setTab] = useState(() => (window.location.hash.replace('#', '') === 'quiz' ? 'quiz' : 'flow'));

  const [quizzes, setQuizzes] = useState([]);
  const [entriesByQuiz, setEntriesByQuiz] = useState({});
  const [expandedQuiz, setExpandedQuiz] = useState(null);
  const [expandedEntry, setExpandedEntry] = useState(null);

  const [addOpen, setAddOpen] = useState(false);
  const [allQuizzes, setAllQuizzes] = useState([]);
  const [addMode, setAddMode] = useState('existing'); // 'existing' | 'new'
  const [addQuizId, setAddQuizId] = useState('');
  const [newQuizName, setNewQuizName] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');
  const [uploadingQuiz, setUploadingQuiz] = useState(null);

  useDocumentTitle(!loading && ok && campaign ? `${campaign.name} | ${DEFAULT_TAB}` : null);

  const loadCampaign = useCallback(async () => {
    setFetching(true);
    try {
      const { data } = await api.get(`/api/platform/campaigns/${id}`);
      setCampaign(data.campaign);
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to load campaign.', { variant: 'error' });
      if (e.response?.status === 404) navigate('/platform/campaigns');
    } finally {
      setFetching(false);
    }
  }, [id, showToast, navigate]);

  const loadQuizzes = useCallback(async () => {
    try {
      const { data } = await api.get(`/api/platform/campaigns/${id}/quizzes`);
      setQuizzes(data.quizzes || []);
    } catch {
      setQuizzes([]);
    }
  }, [id]);

  useEffect(() => { if (ok) { loadCampaign(); loadQuizzes(); } }, [ok, loadCampaign, loadQuizzes]);

  function changeTab(next) {
    setTab(next);
    navigate(`#${next}`, { replace: true });
  }

  async function toggleQuiz(quizId) {
    if (expandedQuiz === quizId) { setExpandedQuiz(null); return; }
    setExpandedQuiz(quizId);
    if (!entriesByQuiz[quizId]) {
      try {
        const { data } = await api.get(`/api/platform/quizzes/${quizId}/entries`);
        setEntriesByQuiz((prev) => ({ ...prev, [quizId]: data.entries || [] }));
      } catch (e) {
        showToast(e.response?.data?.error || 'Failed to load entries.', { variant: 'error' });
      }
    }
  }

  async function openAddQuiz() {
    setAddMode('existing'); setAddQuizId(''); setNewQuizName(''); setAddError('');
    try {
      const { data } = await api.get('/api/platform/quizzes');
      setAllQuizzes(data.quizzes || []);
    } catch { setAllQuizzes([]); }
    setAddOpen(true);
  }

  async function submitAddQuiz(e) {
    e.preventDefault();
    setAddBusy(true); setAddError('');
    try {
      let quizId = addQuizId;
      if (addMode === 'new') {
        if (!newQuizName.trim()) { setAddError('A quiz name is required.'); setAddBusy(false); return; }
        const { data } = await api.post('/api/platform/quizzes', { name: newQuizName.trim() });
        quizId = data.quiz.quiz_id;
      } else if (!quizId) {
        setAddError('Pick a quiz to link.'); setAddBusy(false); return;
      }
      await api.post(`/api/platform/campaigns/${id}/quizzes`, { quiz_id: Number(quizId) });
      showToast('Quiz linked.', { variant: 'success' });
      setAddOpen(false);
      loadQuizzes();
    } catch (err) {
      setAddError(err.response?.data?.error || 'Failed to add quiz.');
    } finally {
      setAddBusy(false);
    }
  }

  async function unlinkQuiz(quiz) {
    if (!window.confirm(`Remove "${quiz.name}" from this campaign? The quiz and its entries stay available for other campaigns.`)) return;
    try {
      await api.delete(`/api/platform/campaigns/${id}/quizzes/${quiz.quiz_id}`);
      showToast('Quiz removed from campaign.', { variant: 'success' });
      loadQuizzes();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to remove quiz.', { variant: 'error' });
    }
  }

  async function onUploadCsv(quiz, e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setUploadingQuiz(quiz.quiz_id);
    try {
      const parsed = parseCsv(await file.text());
      if (!looksLikeQuiz(parsed)) {
        showToast('That file doesn’t look like a Formidable quiz export (no ID/Timestamp columns).', { variant: 'error' });
        return;
      }
      const entries = mapQuizRows(parsed);
      const { data } = await api.post(`/api/platform/quizzes/${quiz.quiz_id}/entries/import`, { entries });
      const s = data.summary;
      showToast(`Imported ${s.imported} entries · ${s.matched} matched to contacts${s.skipped ? ` · ${s.skipped} skipped` : ''}.`, { variant: 'success' });
      setEntriesByQuiz((prev) => { const n = { ...prev }; delete n[quiz.quiz_id]; return n; });
      if (expandedQuiz === quiz.quiz_id) toggleQuizForce(quiz.quiz_id);
      loadQuizzes();
    } catch (err) {
      showToast(err.response?.data?.error || 'Import failed.', { variant: 'error' });
    } finally {
      setUploadingQuiz(null);
    }
  }
  async function toggleQuizForce(quizId) {
    try {
      const { data } = await api.get(`/api/platform/quizzes/${quizId}/entries`);
      setEntriesByQuiz((prev) => ({ ...prev, [quizId]: data.entries || [] }));
    } catch { /* ignore */ }
  }

  if (!ok) return null;

  const channels = Array.isArray(campaign?.channels) ? campaign.channels : [];

  return (
    <Layout user={user} onLogout={logout}>
      <div className="app-main">
        <button type="button" className="btn btn-ghost" style={{ marginBottom: '0.75rem' }} onClick={() => navigate('/platform/campaigns')}>
          <ArrowLeft size={16} strokeWidth={2} aria-hidden /> All campaigns
        </button>

        {fetching && !campaign ? (
          <p className="muted">Loading…</p>
        ) : campaign ? (
          <>
            <div className="crm-page-header" style={{ alignItems: 'flex-start' }}>
              <div>
                <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                  <Megaphone size={24} strokeWidth={1.75} aria-hidden /> {campaign.name}
                </h1>
                <div className="campaign-lane__badges" style={{ marginTop: '0.5rem' }}>
                  <span className={campaignStatusBadgeClass(campaign.status)}>{campaignStatusLabel(campaign.status)}</span>
                  {campaign.atl_btl && <span className="badge badge-atl-btl">{atlBtlLabel(campaign.atl_btl)}</span>}
                  {channels.map((ch) => <span key={ch} className="badge badge-channel">{campaignChannelLabel(ch)}</span>)}
                </div>
                {campaign.objective && <p className="muted" style={{ margin: '0.5rem 0 0' }}>🎯 {campaign.objective}</p>}
              </div>
            </div>

            <div className="pulse-template-mode-switch" role="tablist" aria-label="Campaign sections" style={{ marginTop: '0.5rem' }}>
              {TABS.map((t) => (
                <button
                  key={t.id} type="button" role="tab" aria-selected={tab === t.id}
                  className={`pulse-template-mode-switch__pill${tab === t.id ? ' pulse-template-mode-switch__pill--active' : ''}`}
                  onClick={() => changeTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'flow' && (
              <div style={{ marginTop: '1.25rem' }}>
                {campaign.stages.length === 0 ? (
                  <p className="muted">No stages yet. Add them on the <button type="button" className="linklike" onClick={() => navigate('/platform/campaigns')}>campaigns board</button>.</p>
                ) : (
                  <>
                    <p className="muted" style={{ marginTop: 0 }}>Read-only view. Edit the flow on the <button type="button" className="linklike" onClick={() => navigate('/platform/campaigns')}>campaigns board</button>.</p>
                    <ol className="flow-list">
                      {campaign.stages.map((s, i) => (
                        <li key={s.stage_id} className="flow-list__item">
                          <span className="campaign-stage__pos">{i + 1}</span>
                          <div className="flow-list__body">
                            <div className="flow-list__title">
                              {s.name}
                              {s.channel && <span className="badge badge-channel">{campaignChannelLabel(s.channel)}</span>}
                              {s.who_filter_name && (
                                <button type="button" className="badge badge--link" onClick={() => navigate(`/platform/contacts?customFilter=${s.who_filter_id}`)}>
                                  <Users2 size={11} aria-hidden /> {s.who_filter_name} <ArrowUpRight size={11} aria-hidden />
                                </button>
                              )}
                            </div>
                            {s.links_to && <div className="campaign-stage__row"><span className="campaign-stage__label">Links to</span> {s.links_to}</div>}
                            {s.blocker && (
                              <div className="campaign-stage__branch">
                                <div className="campaign-stage__row"><GitBranch size={12} aria-hidden /> <span className="campaign-stage__label">If</span> {s.blocker}</div>
                                {s.branch_yes && <div className="campaign-stage__row campaign-stage__row--yes"><span className="campaign-stage__label">Yes →</span> {s.branch_yes}</div>}
                                {s.branch_no && <div className="campaign-stage__row campaign-stage__row--no"><span className="campaign-stage__label">No →</span> {s.branch_no}</div>}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
              </div>
            )}

            {tab === 'quiz' && (
              <div style={{ marginTop: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <p className="muted" style={{ margin: 0, maxWidth: '60ch' }}>
                    Quiz entries ingested from WordPress (Formidable). Read-only{isAdmin ? ' — upload a CSV to refresh (rows reconcile by Formidable ID).' : '.'}
                  </p>
                  {isAdmin && (
                    <button className="btn btn-primary" onClick={openAddQuiz}><Plus size={18} strokeWidth={2} aria-hidden /> Add quiz</button>
                  )}
                </div>

                {quizzes.length === 0 ? (
                  <div className="campaign-empty"><FileQuestion size={30} aria-hidden /><p>No quizzes linked to this campaign yet.</p></div>
                ) : (
                  <div className="quiz-list">
                    {quizzes.map((q) => {
                      const entries = entriesByQuiz[q.quiz_id];
                      const open = expandedQuiz === q.quiz_id;
                      return (
                        <div key={q.quiz_id} className="quiz-card">
                          <div className="quiz-card__head">
                            <button type="button" className="quiz-card__toggle" onClick={() => toggleQuiz(q.quiz_id)}>
                              {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                              <span className="quiz-card__name">{q.name}</span>
                              <span className="badge">{q.entry_count} entries</span>
                            </button>
                            {isAdmin && (
                              <div className="quiz-card__tools">
                                <label className="btn btn-ghost btn-file">
                                  <Upload size={15} strokeWidth={2} aria-hidden /> {uploadingQuiz === q.quiz_id ? 'Uploading…' : 'Upload CSV'}
                                  <input type="file" accept=".csv,text/csv" hidden disabled={uploadingQuiz === q.quiz_id} onChange={(e) => onUploadCsv(q, e)} />
                                </label>
                                <button type="button" className="icon-btn icon-btn--danger" title="Remove from campaign" onClick={() => unlinkQuiz(q)}><Trash2 size={15} aria-hidden /></button>
                              </div>
                            )}
                          </div>

                          {open && (
                            <div className="quiz-card__body">
                              {!entries ? (
                                <p className="muted" style={{ padding: '0.5rem' }}>Loading entries…</p>
                              ) : entries.length === 0 ? (
                                <p className="muted" style={{ padding: '0.5rem' }}>No entries yet. {isAdmin ? 'Upload the Formidable CSV to populate.' : ''}</p>
                              ) : (
                                <div className="table-wrap">
                                  <table className="crm-table quiz-table">
                                    <thead>
                                      <tr>
                                        <th></th>
                                        <th>Name</th><th>Email</th><th>Created</th><th>Persona</th>
                                        <th>Change state</th><th>Change risk</th><th>In contacts</th>
                                        <th>UTM src</th><th>UTM campaign</th><th>UTM medium</th><th>UTM content</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {entries.map((en) => {
                                        const rowOpen = expandedEntry === en.entry_id;
                                        const extra = en.raw && typeof en.raw === 'object'
                                          ? Object.entries(en.raw).filter(([k, v]) => !RAW_HIDDEN.has(k) && String(v).trim() !== '')
                                          : [];
                                        return (
                                          <Fragment key={en.entry_id}>
                                            <tr>
                                              <td>
                                                <button type="button" className="icon-btn" onClick={() => setExpandedEntry(rowOpen ? null : en.entry_id)} aria-label="Toggle details">
                                                  {rowOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                                                </button>
                                              </td>
                                              <td className="crm-table__primary">{en.name || '—'}</td>
                                              <td>{en.email || '—'}</td>
                                              <td>{en.submitted_at ? new Date(en.submitted_at).toLocaleString('en-GB', { timeZone: 'UTC' }) : '—'}</td>
                                              <td>{personaLabel(en.persona)}</td>
                                              <td>{en.change_state ? <span className={changeStateBadgeClass(en.change_state)}>{changeStateLabel(en.change_state)}</span> : '—'}</td>
                                              <td style={{ maxWidth: 260 }}>{en.change_risk || '—'}</td>
                                              <td>
                                                {en.matched_contact_id
                                                  ? <span className="badge badge-won" title="Matched to a contact"><CheckCircle2 size={11} aria-hidden /> {[en.matched_firstname, en.matched_lastname].filter(Boolean).join(' ') || 'Yes'}</span>
                                                  : <span className="muted" style={{ fontSize: '0.8rem' }}>Not yet</span>}
                                              </td>
                                              <td>{en.utm_source || '—'}</td><td>{en.utm_campaign || '—'}</td>
                                              <td>{en.utm_medium || '—'}</td><td>{en.utm_content || '—'}</td>
                                            </tr>
                                            {rowOpen && (
                                              <tr key={`${en.entry_id}-x`} className="quiz-table__detail">
                                                <td></td>
                                                <td colSpan={11}>
                                                  <dl className="enrichment-facts" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
                                                    {extra.length === 0 ? <div><dd className="muted">No extra fields.</dd></div> : extra.map(([k, v]) => (
                                                      <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>
                                                    ))}
                                                  </dl>
                                                </td>
                                              </tr>
                                            )}
                                          </Fragment>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        ) : null}
      </div>

      {addOpen && (
        <div className="modal-backdrop">
          <div className="modal-dialog card" role="dialog" aria-modal aria-labelledby="add-quiz-title">
            <div className="modal-dialog__head">
              <h2 id="add-quiz-title" style={{ fontSize: '1.15rem', fontWeight: 700 }}>Add quiz to campaign</h2>
              <button type="button" className="btn btn-ghost modal-dialog__close" onClick={() => setAddOpen(false)} aria-label="Close"><X size={22} aria-hidden /></button>
            </div>
            <form onSubmit={submitAddQuiz} style={{ marginTop: '1rem' }}>
              <div className="pulse-template-mode-switch" role="tablist" aria-label="Add mode" style={{ marginBottom: '0.75rem' }}>
                <button type="button" role="tab" aria-selected={addMode === 'existing'} className={`pulse-template-mode-switch__pill${addMode === 'existing' ? ' pulse-template-mode-switch__pill--active' : ''}`} onClick={() => setAddMode('existing')}>Link existing</button>
                <button type="button" role="tab" aria-selected={addMode === 'new'} className={`pulse-template-mode-switch__pill${addMode === 'new' ? ' pulse-template-mode-switch__pill--active' : ''}`} onClick={() => setAddMode('new')}>Create new</button>
              </div>
              {addMode === 'existing' ? (
                <div className="field">
                  <label htmlFor="add-quiz-select">Quiz</label>
                  <select id="add-quiz-select" value={addQuizId} onChange={(e) => setAddQuizId(e.target.value)}>
                    <option value="">— Select a quiz —</option>
                    {allQuizzes.filter((q) => !quizzes.some((lq) => lq.quiz_id === q.quiz_id)).map((q) => (
                      <option key={q.quiz_id} value={q.quiz_id}>{q.name} ({q.entry_count} entries)</option>
                    ))}
                  </select>
                  <p className="muted" style={{ fontSize: '0.8rem', margin: '0.3rem 0 0' }}>A quiz can be linked to several campaigns; entries are shared.</p>
                </div>
              ) : (
                <div className="field">
                  <label htmlFor="new-quiz-name">Quiz name</label>
                  <input id="new-quiz-name" value={newQuizName} onChange={(e) => setNewQuizName(e.target.value)} placeholder="e.g. People First Readiness Check" autoFocus />
                </div>
              )}
              {addError && <p className="error">{addError}</p>}
              <div className="modal-dialog__actions">
                <button className="btn btn-ghost" type="button" onClick={() => setAddOpen(false)} disabled={addBusy}>Cancel</button>
                <button className="btn btn-primary" type="submit" disabled={addBusy}>{addBusy ? 'Saving…' : 'Add quiz'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
