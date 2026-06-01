import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ChevronRight } from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import Layout from '../components/shared/Layout.jsx';
import { BUSINESS_UNITS, LEAD_STATUSES, LEAD_STATUS_BADGE } from '../config/crmConstants.js';
import '../styles/crm.css';

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PlatformOrganisations() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const { showToast } = useToast();

  const [orgs, setOrgs] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [search, setSearch] = useState('');
  const [buFilter, setBuFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    organisation_name: '', industry: '', website: '', phone: '',
    business_unit: BUSINESS_UNITS[0], lead_status: 'New', lead_source: '', expected_close_date: '',
  });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  useDocumentTitle(!loading && ok ? `Organisations | ${DEFAULT_TAB}` : null);

  const load = useCallback(async () => {
    setFetching(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (buFilter) params.businessUnit = buFilter;
      if (statusFilter) params.leadStatus = statusFilter;
      const { data } = await api.get('/api/platform/crm/organisations', { params });
      setOrgs(data.organisations || []);
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to load organisations.', 'error');
    } finally {
      setFetching(false);
    }
  }, [search, buFilter, statusFilter, showToast]);

  useEffect(() => { if (ok) load(); }, [ok, load]);

  async function create(e) {
    e.preventDefault();
    if (!form.organisation_name.trim()) { setFormError('Organisation name is required.'); return; }
    setBusy(true); setFormError('');
    try {
      const { data } = await api.post('/api/platform/crm/organisations', form);
      showToast('Organisation created.', 'success');
      setCreateOpen(false);
      setForm({ organisation_name: '', industry: '', website: '', phone: '', business_unit: BUSINESS_UNITS[0], lead_status: 'New', lead_source: '', expected_close_date: '' });
      navigate(`/platform/crm/organisations/${data.organisation.organisation_id}`);
    } catch (e) {
      setFormError(e.response?.data?.error || 'Failed to create organisation.');
    } finally {
      setBusy(false);
    }
  }

  if (!ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <div className="app-main">
        <div className="crm-page-header">
          <h1>Organisations</h1>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={18} strokeWidth={2} aria-hidden /> New Organisation
          </button>
        </div>

        <div className="crm-filter-bar">
          <input
            type="search" placeholder="Search organisations…" value={search}
            onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 220 }}
          />
          <select value={buFilter} onChange={(e) => setBuFilter(e.target.value)}>
            <option value="">All business units</option>
            {BUSINESS_UNITS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="table-wrap">
          <table className="platform-users-table">
            <thead>
              <tr>
                <th>Organisation</th>
                <th>Business Unit</th>
                <th>Status</th>
                <th>Industry</th>
                <th>Last Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fetching && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>Loading…</td></tr>
              )}
              {!fetching && orgs.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>
                  No organisations yet. Add one to get started.
                </td></tr>
              )}
              {orgs.map((o) => (
                <tr
                  key={o.organisation_id}
                  className="platform-users-table__row--clickable"
                  onClick={() => navigate(`/platform/crm/organisations/${o.organisation_id}`)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/platform/crm/organisations/${o.organisation_id}`)}
                >
                  <td style={{ fontWeight: 600 }}>{o.organisation_name}</td>
                  <td style={{ color: 'var(--muted)' }}>{o.business_unit}</td>
                  <td><span className={LEAD_STATUS_BADGE[o.lead_status] || 'badge'}>{o.lead_status}</span></td>
                  <td style={{ color: 'var(--muted)' }}>{o.industry || '—'}</td>
                  <td style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>{fmtDate(o.updated_at)}</td>
                  <td><ChevronRight size={16} strokeWidth={2} color="var(--muted)" aria-hidden /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {createOpen && (
        <div className="modal-backdrop" onClick={() => setCreateOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-labelledby="create-org-title">
            <div className="modal-dialog__head">
              <h2 id="create-org-title">New Organisation</h2>
              <button className="modal-dialog__close" onClick={() => setCreateOpen(false)} aria-label="Close" />
            </div>
            <form onSubmit={create}>
              <div className="field">
                <label htmlFor="org-name">Organisation name *</label>
                <input id="org-name" value={form.organisation_name} onChange={(e) => setForm((p) => ({ ...p, organisation_name: e.target.value }))} required autoFocus />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="field">
                  <label htmlFor="org-bu">Business unit</label>
                  <select id="org-bu" value={form.business_unit} onChange={(e) => setForm((p) => ({ ...p, business_unit: e.target.value }))}>
                    {BUSINESS_UNITS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="org-status">Lead status</label>
                  <select id="org-status" value={form.lead_status} onChange={(e) => setForm((p) => ({ ...p, lead_status: e.target.value }))}>
                    {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="field">
                  <label htmlFor="org-industry">Industry</label>
                  <input id="org-industry" value={form.industry} onChange={(e) => setForm((p) => ({ ...p, industry: e.target.value }))} />
                </div>
                <div className="field">
                  <label htmlFor="org-source">Lead source</label>
                  <input id="org-source" value={form.lead_source} onChange={(e) => setForm((p) => ({ ...p, lead_source: e.target.value }))} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="org-website">Website</label>
                <input id="org-website" type="url" value={form.website} onChange={(e) => setForm((p) => ({ ...p, website: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="field">
                  <label htmlFor="org-phone">Phone</label>
                  <input id="org-phone" type="tel" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
                </div>
                <div className="field">
                  <label htmlFor="org-close">Expected close date</label>
                  <input id="org-close" type="date" value={form.expected_close_date} onChange={(e) => setForm((p) => ({ ...p, expected_close_date: e.target.value }))} />
                </div>
              </div>
              {formError && <p className="error">{formError}</p>}
              <div className="modal-dialog__actions">
                <button className="btn btn-ghost" type="button" onClick={() => setCreateOpen(false)}>Cancel</button>
                <button className="btn btn-primary" type="submit" disabled={busy}>Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
