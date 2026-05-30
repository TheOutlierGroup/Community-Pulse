import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Plus, X, Lock, ChevronDown } from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import Layout from '../components/shared/Layout.jsx';
import '../styles/crm.css';

function fmtDate(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function LeadBadge({ lead }) {
  if (lead.wonAt) return <span className="badge badge-won">Won</span>;
  if (lead.lostAt) return <span className="badge badge-lost">Lost</span>;
  return null;
}

function LeadCard({ lead, onClick }) {
  return (
    <div className="lead-card" onClick={() => onClick(lead)} tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick(lead)} role="button" aria-label={`Open lead: ${lead.title}`}>
      <div className="lead-card__title">{lead.title}</div>
      <div className="lead-card__meta">
        <span>{lead.accountName}</span>
        {lead.contactName && <span>{lead.contactName}</span>}
        {lead.expectedCloseDate && <span>Close: {fmtDate(lead.expectedCloseDate)}</span>}
      </div>
      {lead.lockedAt && (
        <div className="lead-card__locked">
          <Lock size={11} strokeWidth={2.5} aria-hidden /> Won
        </div>
      )}
      {lead.lostAt && <span className="badge badge-lost" style={{ marginTop: '0.4rem', display: 'inline-block' }}>Lost</span>}
    </div>
  );
}

function LeadDetail({ lead, onClose, onConvert, onMarkLost, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [lostReason, setLostReason] = useState('');
  const [showLost, setShowLost] = useState(false);
  const [estimates, setEstimates] = useState([]);
  const [activity, setActivity] = useState([]);
  const { showToast } = useToast();

  useEffect(() => {
    if (!lead) return;
    Promise.all([
      api.get(`/api/platform/leads/${lead.id}`),
      api.get(`/api/platform/leads/${lead.id}/activity`),
    ]).then(([detailRes, actRes]) => {
      setEstimates(detailRes.data.estimates || []);
      setActivity(actRes.data.activity || []);
    }).catch(() => {});
  }, [lead]);

  async function convert() {
    if (!window.confirm('Convert this lead to a project? The lead will be locked.')) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/api/platform/leads/${lead.id}/convert`);
      showToast('Lead converted to project!', 'success');
      onConvert(data.project);
    } catch (e) {
      showToast(e.response?.data?.error || 'Conversion failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function markLost(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/api/platform/leads/${lead.id}/mark-lost`, { reason: lostReason });
      showToast('Lead marked as lost.', 'success');
      onMarkLost();
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const totalCost = estimates.reduce((s, e) => s + (Number(e.unit_cost || 0) * Number(e.quantity || 1)), 0);
  const totalHours = estimates.reduce((s, e) => s + (Number(e.hours || 0) * Number(e.quantity || 1)), 0);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 40, display: 'flex' }}>
      <div style={{ flex: 1, background: 'rgba(0,0,0,0.35)' }} onClick={onClose} />
      <div style={{ width: 'min(480px, 100vw)', background: 'var(--surface)', boxShadow: '-4px 0 32px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem' }}>{lead.title}</h2>
            <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>{lead.accountName} · {lead.buName}</div>
          </div>
          <button className="btn btn-ghost" style={{ padding: '0.4rem', flexShrink: 0 }} onClick={onClose} aria-label="Close">
            <X size={20} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div style={{ padding: '1.25rem 1.5rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Status */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="badge badge-draft">{lead.stageName}</span>
            {lead.wonAt && <span className="badge badge-won">Won</span>}
            {lead.lostAt && <span className="badge badge-lost">Lost</span>}
            {lead.lockedAt && (
              <span style={{ fontSize: '0.78rem', color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <Lock size={12} strokeWidth={2.5} aria-hidden /> Locked
              </span>
            )}
          </div>

          {/* Meta */}
          <div style={{ fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <div><span style={{ color: 'var(--muted)' }}>Contact: </span>{lead.contactName || '—'} {lead.contactEmail ? `(${lead.contactEmail})` : ''}</div>
            {lead.expectedCloseDate && <div><span style={{ color: 'var(--muted)' }}>Expected close: </span>{fmtDate(lead.expectedCloseDate)}</div>}
            {lead.source && <div><span style={{ color: 'var(--muted)' }}>Source: </span>{lead.source}</div>}
            {lead.description && <div style={{ marginTop: '0.25rem', lineHeight: 1.5 }}>{lead.description}</div>}
          </div>

          {/* Estimates */}
          {estimates.length > 0 && (
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: '0.5rem' }}>Estimates</div>
              {estimates.map((est) => (
                <div key={est.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
                  <span>{est.description}</span>
                  <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap', marginLeft: '1rem' }}>
                    {est.hours ? `${est.hours}h` : ''} {est.unit_cost ? `$${Number(est.unit_cost).toLocaleString()}` : ''}
                  </span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', fontWeight: 700, paddingTop: '0.5rem' }}>
                <span>Total</span>
                <span>{totalHours > 0 ? `${totalHours}h · ` : ''}{totalCost > 0 ? `$${totalCost.toLocaleString()}` : '—'}</span>
              </div>
            </div>
          )}

          {/* Actions */}
          {!lead.lockedAt && !lead.lostAt && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <button className="btn btn-primary" onClick={convert} disabled={busy} style={{ width: '100%' }}>
                Mark as Won & Convert to Project
              </button>
              <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => setShowLost((v) => !v)}>
                Mark as Lost {showLost ? <ChevronDown size={14} style={{ transform: 'rotate(180deg)' }} /> : <ChevronDown size={14} />}
              </button>
              {showLost && (
                <form onSubmit={markLost} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Reason (optional)</label>
                    <input value={lostReason} onChange={(e) => setLostReason(e.target.value)} />
                  </div>
                  <button className="btn btn-danger" type="submit" disabled={busy}>Confirm: Mark as Lost</button>
                </form>
              )}
            </div>
          )}

          {/* Activity */}
          {activity.length > 0 && (
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: '0.5rem' }}>Activity</div>
              <div className="activity-feed">
                {activity.slice(0, 10).map((a) => (
                  <div key={a.id} className="activity-item">
                    <div className="activity-item__dot" />
                    <div className="activity-item__body">
                      <div className="activity-item__text">{a.eventType.replace(/_/g, ' ')}</div>
                      <div className="activity-item__time">{fmtDate(a.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateLeadModal({ onClose, onCreated }) {
  const [bus, setBus] = useState([]);
  const [stages, setStages] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [form, setForm] = useState({ title: '', businessUnitId: '', pipelineStageId: '', accountId: '', contactId: '', description: '', expectedCloseDate: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { showToast } = useToast();

  useEffect(() => {
    Promise.all([
      api.get('/api/platform/business-units'),
      api.get('/api/platform/accounts', { params: { limit: 200 } }),
    ]).then(([buRes, accRes]) => {
      setBus(buRes.data.businessUnits || []);
      setAccounts(accRes.data.accounts || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!form.businessUnitId) { setStages([]); setForm((p) => ({ ...p, pipelineStageId: '' })); return; }
    api.get(`/api/platform/business-units/${form.businessUnitId}/pipeline-stages`)
      .then(({ data }) => setStages(data.stages || []))
      .catch(() => setStages([]));
  }, [form.businessUnitId]);

  useEffect(() => {
    if (!form.accountId) { setContacts([]); setForm((p) => ({ ...p, contactId: '' })); return; }
    api.get(`/api/platform/accounts/${form.accountId}`)
      .then(({ data }) => setContacts(data.contacts || []))
      .catch(() => setContacts([]));
  }, [form.accountId]);

  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.businessUnitId || !form.pipelineStageId || !form.accountId || !form.contactId) {
      setError('Please fill in all required fields.'); return;
    }
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/api/platform/leads', {
        title: form.title,
        businessUnitId: form.businessUnitId,
        pipelineStageId: form.pipelineStageId,
        accountId: form.accountId,
        contactId: form.contactId,
        description: form.description || undefined,
        expectedCloseDate: form.expectedCloseDate || undefined,
      });
      showToast('Lead created.', 'success');
      onCreated(data.lead);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to create lead.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog modal-dialog--wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-labelledby="create-lead-title">
        <div className="modal-dialog__head">
          <h2 id="create-lead-title">New Lead</h2>
          <button className="modal-dialog__close" onClick={onClose} aria-label="Close" />
        </div>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="lead-title">Title *</label>
            <input id="lead-title" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} autoFocus required />
          </div>
          <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field">
              <label htmlFor="lead-bu">Business unit *</label>
              <select id="lead-bu" value={form.businessUnitId} onChange={(e) => setForm((p) => ({ ...p, businessUnitId: e.target.value }))} required>
                <option value="">Select…</option>
                {bus.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="lead-stage">Pipeline stage *</label>
              <select id="lead-stage" value={form.pipelineStageId} onChange={(e) => setForm((p) => ({ ...p, pipelineStageId: e.target.value }))} required disabled={!form.businessUnitId}>
                <option value="">Select…</option>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="lead-account">Account *</label>
              <select id="lead-account" value={form.accountId} onChange={(e) => setForm((p) => ({ ...p, accountId: e.target.value }))} required>
                <option value="">Select…</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="lead-contact">Contact *</label>
              <select id="lead-contact" value={form.contactId} onChange={(e) => setForm((p) => ({ ...p, contactId: e.target.value }))} required disabled={!form.accountId}>
                <option value="">Select…</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="lead-desc">Description</label>
            <textarea id="lead-desc" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} style={{ minHeight: 80 }} />
          </div>
          <div className="field">
            <label htmlFor="lead-close">Expected close date</label>
            <input id="lead-close" type="date" value={form.expectedCloseDate} onChange={(e) => setForm((p) => ({ ...p, expectedCloseDate: e.target.value }))} />
          </div>
          {error && <p className="error">{error}</p>}
          <div className="modal-dialog__actions">
            <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" type="submit" disabled={busy}>Create lead</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PlatformLeads() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);

  const [bus, setBus] = useState([]);
  const [selectedBu, setSelectedBu] = useState('');
  const [stages, setStages] = useState([]);
  const [leads, setLeads] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [filterStatus, setFilterStatus] = useState('open');

  useDocumentTitle(!loading && ok ? `Leads | ${DEFAULT_TAB}` : null);

  useEffect(() => {
    if (!ok) return;
    api.get('/api/platform/business-units')
      .then(({ data }) => {
        const active = data.businessUnits || [];
        setBus(active);
        if (active.length > 0) setSelectedBu(active[0].id);
      })
      .catch(() => {});
  }, [ok]);

  useEffect(() => {
    if (!selectedBu) return;
    api.get(`/api/platform/business-units/${selectedBu}/pipeline-stages`)
      .then(({ data }) => setStages(data.stages || []))
      .catch(() => setStages([]));
  }, [selectedBu]);

  const loadLeads = useCallback(async () => {
    if (!ok) return;
    setFetching(true);
    try {
      const params = {
        businessUnitId: selectedBu || undefined,
        openOnly: filterStatus === 'open' ? 'true' : undefined,
        wonOnly: filterStatus === 'won' ? 'true' : undefined,
        lostOnly: filterStatus === 'lost' ? 'true' : undefined,
        limit: 200,
      };
      const { data } = await api.get('/api/platform/leads', { params });
      setLeads(data.leads || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load leads.');
    } finally {
      setFetching(false);
    }
  }, [ok, selectedBu, filterStatus]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const leadsByStage = stages.reduce((acc, stage) => {
    acc[stage.id] = leads.filter((l) => l.pipelineStageId === stage.id);
    return acc;
  }, {});

  // Leads not matching any current stage (won/lost shown if filter matches)
  const wonLeads = filterStatus !== 'open' ? leads.filter((l) => l.wonAt) : [];
  const lostLeads = filterStatus !== 'open' ? leads.filter((l) => l.lostAt) : [];

  if (!ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <div style={{ padding: 'var(--space)', maxWidth: '100%' }}>
        <div className="crm-page-header">
          <h1>Leads</h1>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={18} strokeWidth={2} aria-hidden /> New Lead
          </button>
        </div>

        <div className="crm-filter-bar">
          {bus.length > 0 && (
            <select value={selectedBu} onChange={(e) => setSelectedBu(e.target.value)} aria-label="Select business unit">
              <option value="">All BUs</option>
              {bus.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} aria-label="Filter by status">
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="all">All</option>
          </select>
        </div>

        {error && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}
        {bus.length === 0 && !fetching && (
          <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
            <p className="muted" style={{ marginBottom: '1rem' }}>No business units configured yet.</p>
            {user?.role === 'admin' && (
              <button className="btn btn-primary" onClick={() => navigate('/platform/crm/settings')}>
                Set up Business Units
              </button>
            )}
          </div>
        )}

        {bus.length > 0 && (
          <div className="pipeline-board">
            {stages.map((stage) => (
              <div
                key={stage.id}
                className={`pipeline-col${stage.isWon ? ' pipeline-col--won' : ''}${stage.isLost ? ' pipeline-col--lost' : ''}`}
              >
                <div className="pipeline-col__header">
                  <span className="pipeline-col__title">{stage.name}</span>
                  <span className="pipeline-col__count">{leadsByStage[stage.id]?.length ?? 0}</span>
                </div>
                <div className="pipeline-col__body">
                  {fetching && <p className="muted" style={{ fontSize: '0.8rem', textAlign: 'center' }}>Loading…</p>}
                  {!fetching && (leadsByStage[stage.id] || []).length === 0 && (
                    <p style={{ fontSize: '0.78rem', color: 'var(--muted)', textAlign: 'center', padding: '1rem 0' }}>Empty</p>
                  )}
                  {(leadsByStage[stage.id] || []).map((lead) => (
                    <LeadCard key={lead.id} lead={lead} onClick={setSelectedLead} />
                  ))}
                </div>
              </div>
            ))}

            {wonLeads.length > 0 && (
              <div className="pipeline-col pipeline-col--won">
                <div className="pipeline-col__header">
                  <span className="pipeline-col__title">Won</span>
                  <span className="pipeline-col__count">{wonLeads.length}</span>
                </div>
                <div className="pipeline-col__body">
                  {wonLeads.map((lead) => <LeadCard key={lead.id} lead={lead} onClick={setSelectedLead} />)}
                </div>
              </div>
            )}

            {lostLeads.length > 0 && (
              <div className="pipeline-col pipeline-col--lost">
                <div className="pipeline-col__header">
                  <span className="pipeline-col__title">Lost</span>
                  <span className="pipeline-col__count">{lostLeads.length}</span>
                </div>
                <div className="pipeline-col__body">
                  {lostLeads.map((lead) => <LeadCard key={lead.id} lead={lead} onClick={setSelectedLead} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {createOpen && (
        <CreateLeadModal onClose={() => setCreateOpen(false)} onCreated={(lead) => { setCreateOpen(false); loadLeads(); setSelectedLead(lead); }} />
      )}

      {selectedLead && (
        <LeadDetail
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onConvert={(project) => { setSelectedLead(null); navigate(`/platform/crm/projects/${project.id}`); }}
          onMarkLost={() => { setSelectedLead(null); loadLeads(); }}
          onRefresh={loadLeads}
        />
      )}
    </Layout>
  );
}
