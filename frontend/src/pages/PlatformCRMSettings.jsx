import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, Webhook, Building2, ChevronDown, ChevronRight } from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import Layout from '../components/shared/Layout.jsx';
import '../styles/crm.css';

const WEBHOOK_EVENTS = [
  'lead.created', 'lead.updated', 'lead.won', 'lead.lost',
  'project.created', 'project.status_changed', 'project.over_budget',
];

export default function PlatformCRMSettings() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const { showToast } = useToast();

  useDocumentTitle(!loading && ok ? `CRM Settings | ${DEFAULT_TAB}` : null);

  // ── Business Units ─────────────────────────────────────────────────────────
  const [bus, setBus] = useState([]);
  const [buLoading, setBuLoading] = useState(false);
  const [createBuOpen, setCreateBuOpen] = useState(false);
  const [buForm, setBuForm] = useState({ name: '', code: '' });
  const [buBusy, setBuBusy] = useState(false);
  const [expandedBu, setExpandedBu] = useState(null);
  const [stages, setStages] = useState({});
  const [stageForm, setStageForm] = useState({ name: '', isWon: false, isLost: false });
  const [addingStage, setAddingStage] = useState(null);

  const loadBus = useCallback(async () => {
    setBuLoading(true);
    try {
      const { data } = await api.get('/api/platform/business-units');
      setBus(data.businessUnits || []);
    } catch {
      showToast('Failed to load business units.', 'error');
    } finally {
      setBuLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!ok) return;
    loadBus();
  }, [ok, loadBus]);

  async function createBu(e) {
    e.preventDefault();
    if (!buForm.name.trim()) return;
    setBuBusy(true);
    try {
      await api.post('/api/platform/business-units', buForm);
      showToast('Business unit created.', 'success');
      setCreateBuOpen(false);
      setBuForm({ name: '', code: '' });
      loadBus();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to create BU.', 'error');
    } finally {
      setBuBusy(false);
    }
  }

  async function deleteBu(buId) {
    if (!confirm('Delete this business unit? This cannot be undone.')) return;
    try {
      await api.delete(`/api/platform/business-units/${buId}`);
      showToast('Business unit deleted.', 'success');
      loadBus();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to delete BU.', 'error');
    }
  }

  async function expandBu(bu) {
    if (expandedBu === bu.id) { setExpandedBu(null); return; }
    setExpandedBu(bu.id);
    if (stages[bu.id]) return;
    try {
      const { data } = await api.get(`/api/platform/business-units/${bu.id}/pipeline-stages`);
      setStages((p) => ({ ...p, [bu.id]: data.stages || [] }));
    } catch { /* ignore */ }
  }

  async function addStage(buId) {
    if (!stageForm.name.trim()) return;
    try {
      await api.post(`/api/platform/business-units/${buId}/pipeline-stages`, stageForm);
      showToast('Stage added.', 'success');
      setStageForm({ name: '', isWon: false, isLost: false });
      setAddingStage(null);
      const { data } = await api.get(`/api/platform/business-units/${buId}/pipeline-stages`);
      setStages((p) => ({ ...p, [buId]: data.stages || [] }));
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to add stage.', 'error');
    }
  }

  async function deleteStage(buId, stageId) {
    try {
      await api.delete(`/api/platform/business-units/${buId}/pipeline-stages/${stageId}`);
      showToast('Stage deleted.', 'success');
      const { data } = await api.get(`/api/platform/business-units/${buId}/pipeline-stages`);
      setStages((p) => ({ ...p, [buId]: data.stages || [] }));
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to delete stage.', 'error');
    }
  }

  // ── Webhook Endpoints ──────────────────────────────────────────────────────
  const [endpoints, setEndpoints] = useState([]);
  const [epLoading, setEpLoading] = useState(false);
  const [createEpOpen, setCreateEpOpen] = useState(false);
  const [epForm, setEpForm] = useState({ url: '', events: [] });
  const [epBusy, setEpBusy] = useState(false);
  const [expandedEp, setExpandedEp] = useState(null);
  const [epLogs, setEpLogs] = useState({});

  const loadEndpoints = useCallback(async () => {
    setEpLoading(true);
    try {
      const { data } = await api.get('/api/platform/webhook-endpoints');
      setEndpoints(data.endpoints || []);
    } catch { /* ignore */ }
    finally { setEpLoading(false); }
  }, []);

  useEffect(() => {
    if (!ok) return;
    loadEndpoints();
  }, [ok, loadEndpoints]);

  async function createEndpoint(e) {
    e.preventDefault();
    if (!epForm.url.trim() || epForm.events.length === 0) {
      showToast('URL and at least one event are required.', 'error');
      return;
    }
    setEpBusy(true);
    try {
      await api.post('/api/platform/webhook-endpoints', epForm);
      showToast('Webhook endpoint created.', 'success');
      setCreateEpOpen(false);
      setEpForm({ url: '', events: [] });
      loadEndpoints();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to create endpoint.', 'error');
    } finally {
      setEpBusy(false);
    }
  }

  async function deleteEndpoint(epId) {
    if (!confirm('Delete this webhook endpoint?')) return;
    try {
      await api.delete(`/api/platform/webhook-endpoints/${epId}`);
      showToast('Endpoint deleted.', 'success');
      loadEndpoints();
    } catch { showToast('Failed to delete endpoint.', 'error'); }
  }

  async function expandEndpoint(ep) {
    if (expandedEp === ep.id) { setExpandedEp(null); return; }
    setExpandedEp(ep.id);
    if (epLogs[ep.id]) return;
    try {
      const { data } = await api.get(`/api/platform/webhook-endpoints/${ep.id}`);
      setEpLogs((p) => ({ ...p, [ep.id]: data.dispatchLog || [] }));
    } catch { /* ignore */ }
  }

  function toggleEvent(ev) {
    setEpForm((p) => ({
      ...p,
      events: p.events.includes(ev) ? p.events.filter((e) => e !== ev) : [...p.events, ev],
    }));
  }

  if (!ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <div className="app-main">
        <div className="crm-page-header">
          <h1>CRM Settings</h1>
        </div>

        {/* ── Business Units section ── */}
        <section style={{ marginBottom: '2.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Building2 size={16} strokeWidth={2} aria-hidden /> Business Units
            </h2>
            <button className="btn btn-primary" onClick={() => setCreateBuOpen(true)}>
              <Plus size={16} strokeWidth={2} aria-hidden /> New BU
            </button>
          </div>

          {createBuOpen && (
            <div className="card" style={{ marginBottom: '1rem', padding: '1.25rem' }}>
              <form onSubmit={createBu}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div className="field">
                    <label>Name *</label>
                    <input value={buForm.name} onChange={(e) => setBuForm((p) => ({ ...p, name: e.target.value }))} required autoFocus />
                  </div>
                  <div className="field">
                    <label>Code</label>
                    <input value={buForm.code} onChange={(e) => setBuForm((p) => ({ ...p, code: e.target.value }))} placeholder="e.g. SALES" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn btn-primary" type="submit" disabled={buBusy}>Create</button>
                  <button className="btn btn-ghost" type="button" onClick={() => setCreateBuOpen(false)}>Cancel</button>
                </div>
              </form>
            </div>
          )}

          {buLoading && <p className="muted">Loading…</p>}
          {!buLoading && bus.length === 0 && <p className="muted">No business units yet.</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {bus.map((bu) => (
              <div key={bu.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.85rem 1.25rem', cursor: 'pointer' }}
                  onClick={() => expandBu(bu)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {expandedBu === bu.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <div>
                      <div style={{ fontWeight: 600 }}>{bu.name}</div>
                      {bu.code && <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{bu.code}</div>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className={`badge ${bu.isActive ? 'badge-active' : 'badge-archived'}`}>{bu.isActive ? 'Active' : 'Inactive'}</span>
                    <button className="btn btn-ghost" style={{ padding: '0.3rem' }} onClick={(e) => { e.stopPropagation(); deleteBu(bu.id); }} aria-label="Delete">
                      <X size={14} strokeWidth={2} />
                    </button>
                  </div>
                </div>

                {expandedBu === bu.id && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '1rem 1.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pipeline stages</span>
                      <button className="btn btn-ghost" style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }} onClick={() => setAddingStage(addingStage === bu.id ? null : bu.id)}>
                        {addingStage === bu.id ? 'Cancel' : <><Plus size={13} /> Add stage</>}
                      </button>
                    </div>

                    {addingStage === bu.id && (
                      <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '0.85rem', marginBottom: '0.75rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.5rem', alignItems: 'end' }}>
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label style={{ fontSize: '0.8rem' }}>Stage name *</label>
                            <input value={stageForm.name} onChange={(e) => setStageForm((p) => ({ ...p, name: e.target.value }))} autoFocus />
                          </div>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', whiteSpace: 'nowrap', paddingBottom: '0.1rem' }}>
                            <input type="checkbox" checked={stageForm.isWon} onChange={(e) => setStageForm((p) => ({ ...p, isWon: e.target.checked, isLost: false }))} /> Won
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', whiteSpace: 'nowrap', paddingBottom: '0.1rem' }}>
                            <input type="checkbox" checked={stageForm.isLost} onChange={(e) => setStageForm((p) => ({ ...p, isLost: e.target.checked, isWon: false }))} /> Lost
                          </label>
                        </div>
                        <button className="btn btn-primary" style={{ marginTop: '0.65rem', fontSize: '0.85rem' }} onClick={() => addStage(bu.id)}>Add</button>
                      </div>
                    )}

                    {!stages[bu.id] && <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>Loading…</p>}
                    {stages[bu.id] && stages[bu.id].length === 0 && <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>No stages yet.</p>}
                    {stages[bu.id]?.map((s, i) => (
                      <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.875rem' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ color: 'var(--muted)', fontSize: '0.75rem', width: '1rem' }}>{i + 1}</span>
                          {s.name}
                          {s.isWon && <span className="badge badge-won" style={{ fontSize: '0.7rem' }}>Won</span>}
                          {s.isLost && <span className="badge badge-lost" style={{ fontSize: '0.7rem' }}>Lost</span>}
                        </span>
                        <button className="btn btn-ghost" style={{ padding: '0.25rem' }} onClick={() => deleteStage(bu.id, s.id)} aria-label="Delete stage">
                          <X size={13} strokeWidth={2} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── Webhook Endpoints section ── */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Webhook size={16} strokeWidth={2} aria-hidden /> Webhook Endpoints
            </h2>
            <button className="btn btn-primary" onClick={() => setCreateEpOpen(true)}>
              <Plus size={16} strokeWidth={2} aria-hidden /> New endpoint
            </button>
          </div>

          {createEpOpen && (
            <div className="card" style={{ marginBottom: '1rem', padding: '1.25rem' }}>
              <form onSubmit={createEndpoint}>
                <div className="field">
                  <label>Endpoint URL *</label>
                  <input type="url" value={epForm.url} onChange={(e) => setEpForm((p) => ({ ...p, url: e.target.value }))} placeholder="https://…" required autoFocus />
                </div>
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={{ fontSize: '0.875rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>Events *</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {WEBHOOK_EVENTS.map((ev) => (
                      <label key={ev} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem', background: 'var(--surface2)', padding: '0.3rem 0.6rem', borderRadius: 8, cursor: 'pointer' }}>
                        <input type="checkbox" checked={epForm.events.includes(ev)} onChange={() => toggleEvent(ev)} />
                        {ev}
                      </label>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn btn-primary" type="submit" disabled={epBusy}>Create</button>
                  <button className="btn btn-ghost" type="button" onClick={() => setCreateEpOpen(false)}>Cancel</button>
                </div>
              </form>
            </div>
          )}

          {epLoading && <p className="muted">Loading…</p>}
          {!epLoading && endpoints.length === 0 && <p className="muted">No webhook endpoints configured.</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {endpoints.map((ep) => (
              <div key={ep.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.85rem 1.25rem', cursor: 'pointer' }}
                  onClick={() => expandEndpoint(ep)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {expandedEp === ep.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', wordBreak: 'break-all' }}>{ep.url}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.15rem' }}>
                        {(ep.events || []).join(', ')}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                    <span className={`badge ${ep.isActive ? 'badge-active' : 'badge-archived'}`}>{ep.isActive ? 'Active' : 'Disabled'}</span>
                    <button className="btn btn-ghost" style={{ padding: '0.3rem' }} onClick={(e) => { e.stopPropagation(); deleteEndpoint(ep.id); }} aria-label="Delete">
                      <X size={14} strokeWidth={2} />
                    </button>
                  </div>
                </div>

                {expandedEp === ep.id && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '1rem 1.25rem' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.5rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Signing secret</div>
                    <code style={{ fontSize: '0.78rem', background: 'var(--surface2)', padding: '0.3rem 0.6rem', borderRadius: 6 }}>{ep.signingSecret}</code>
                    <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '1rem', marginBottom: '0.5rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recent dispatches</div>
                    {!epLogs[ep.id] && <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>Loading…</p>}
                    {epLogs[ep.id]?.length === 0 && <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>No dispatches yet.</p>}
                    {epLogs[ep.id]?.slice(0, 10).map((l) => (
                      <div key={l.id} style={{ display: 'flex', gap: '0.75rem', padding: '0.4rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.8rem', alignItems: 'center' }}>
                        <span className={`badge ${l.status === 'success' ? 'badge-won' : 'badge-lost'}`} style={{ fontSize: '0.7rem' }}>{l.status}</span>
                        <span style={{ color: 'var(--muted)' }}>{l.eventName}</span>
                        {l.responseStatus && <span style={{ color: 'var(--muted)' }}>HTTP {l.responseStatus}</span>}
                        <span style={{ color: 'var(--muted)', marginLeft: 'auto' }}>{new Date(l.createdAt).toLocaleString('en-AU')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </Layout>
  );
}
