import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown, X } from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import Layout from '../components/shared/Layout.jsx';
import AuthenticatedBlobImage from '../components/platform/AuthenticatedBlobImage.jsx';
import { BUSINESS_UNITS, LEAD_STATUSES, LEAD_STATUS_BADGE, BUSINESS_UNIT_CUSTOM_FIELDS } from '../config/crmConstants.js';
import '../styles/crm.css';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Sortable columns cycle through 3 states per click: default -> ascending ->
// descending -> default. `column: null` represents "default", which always
// renders as most-recently-updated-first regardless of which column was
// last explicitly sorted.
const SORTABLE_COLUMNS = {
  organisation: (o) => String(o.organisation_name || ''),
  industry: (o) => String(o.industry || ''),
  updated: (o) => new Date(o.updated_at || 0).getTime(),
};

function nextSortState(current, column) {
  if (current.column !== column) return { column, direction: 'asc' };
  if (current.direction === 'asc') return { column, direction: 'desc' };
  return { column: null, direction: null };
}

// The effective sort always has an active column/direction, even in the
// "default" state, since default falls back to most-recently-updated-first.
function effectiveSort(sort) {
  return sort.column
    ? { column: sort.column, direction: sort.direction }
    : { column: 'updated', direction: 'desc' };
}

function sortIndicator(sort, column) {
  const eff = effectiveSort(sort);
  if (eff.column !== column) {
    return <ChevronsUpDown size={14} strokeWidth={2} className="crm-table__sort-icon crm-table__sort-icon--inactive" aria-hidden />;
  }
  return eff.direction === 'asc'
    ? <ChevronUp size={14} strokeWidth={2.25} className="crm-table__sort-icon" aria-hidden />
    : <ChevronDown size={14} strokeWidth={2.25} className="crm-table__sort-icon" aria-hidden />;
}

function ariaSortFor(sort, column) {
  const eff = effectiveSort(sort);
  if (eff.column !== column) return 'none';
  return eff.direction === 'asc' ? 'ascending' : 'descending';
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
  const [sort, setSort] = useState({ column: null, direction: null });

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    organisation_name: '', industry: '', website: '', phone: '',
    business_unit: BUSINESS_UNITS[0], lead_status: 'New', lead_source: '', expected_close_date: '',
  });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  // After creating a prospect whose Business Unit has its own custom-field
  // set (currently just Outlier Skate), collect those fields in a follow-up
  // modal instead of sending the user straight to Configurations for them.
  const [customFieldsOrg, setCustomFieldsOrg] = useState(null);
  const [customFieldsForm, setCustomFieldsForm] = useState({});
  const [customFieldsBusy, setCustomFieldsBusy] = useState(false);

  useDocumentTitle(!loading && ok ? `Prospects | ${DEFAULT_TAB}` : null);

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
      showToast(e.response?.data?.error || 'Failed to load organisations.', { variant: 'error' });
    } finally {
      setFetching(false);
    }
  }, [search, buFilter, statusFilter, showToast]);

  useEffect(() => { if (ok) load(); }, [ok, load]);

  function toggleSort(column) {
    setSort((current) => nextSortState(current, column));
  }

  const sortedOrgs = useMemo(() => {
    const activeColumn = sort.column || 'updated';
    const direction = sort.column ? sort.direction : 'desc';
    const dirMultiplier = direction === 'asc' ? 1 : -1;
    const getValue = SORTABLE_COLUMNS[activeColumn];
    return [...orgs].sort((a, b) => {
      const av = getValue(a);
      const bv = getValue(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dirMultiplier;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * dirMultiplier;
    });
  }, [orgs, sort]);

  async function create(e) {
    e.preventDefault();
    if (!form.organisation_name.trim()) { setFormError('Organisation name is required.'); return; }
    setBusy(true); setFormError('');
    try {
      const { data } = await api.post('/api/platform/crm/organisations', form);
      const created = data.organisation;
      showToast('Organisation created.', { variant: 'success' });
      setCreateOpen(false);
      setForm({ organisation_name: '', industry: '', website: '', phone: '', business_unit: BUSINESS_UNITS[0], lead_status: 'New', lead_source: '', expected_close_date: '' });
      const customFieldDefs = BUSINESS_UNIT_CUSTOM_FIELDS[created.business_unit];
      if (customFieldDefs?.length) {
        setCustomFieldsForm({});
        setCustomFieldsOrg(created);
      } else {
        navigate(`/platform/crm/organisations/${created.organisation_id}`);
      }
    } catch (e) {
      setFormError(e.response?.data?.error || 'Failed to create organisation.');
    } finally {
      setBusy(false);
    }
  }

  function goToCreatedOrg() {
    const orgId = customFieldsOrg.organisation_id;
    setCustomFieldsOrg(null);
    navigate(`/platform/crm/organisations/${orgId}`);
  }

  async function saveCustomFieldsAndContinue(e) {
    e.preventDefault();
    setCustomFieldsBusy(true);
    try {
      await api.patch(`/api/platform/crm/organisations/${customFieldsOrg.organisation_id}`, {
        custom_fields: customFieldsForm,
      });
      showToast('Details saved.', { variant: 'success' });
      goToCreatedOrg();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to save details.', { variant: 'error' });
    } finally {
      setCustomFieldsBusy(false);
    }
  }

  if (!ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <div className="app-main">
        <div className="crm-page-header">
          <h1>Prospects</h1>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={18} strokeWidth={2} aria-hidden /> New Prospect
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
          <table className="crm-table">
            <thead>
              <tr>
                <th aria-sort={ariaSortFor(sort, 'organisation')}>
                  <button type="button" className="crm-table__sort-btn" onClick={() => toggleSort('organisation')}>
                    Organisation {sortIndicator(sort, 'organisation')}
                  </button>
                </th>
                <th>Status</th>
                <th>Business Unit</th>
                <th aria-sort={ariaSortFor(sort, 'industry')}>
                  <button type="button" className="crm-table__sort-btn" onClick={() => toggleSort('industry')}>
                    Industry {sortIndicator(sort, 'industry')}
                  </button>
                </th>
                <th aria-sort={ariaSortFor(sort, 'updated')}>
                  <button type="button" className="crm-table__sort-btn" onClick={() => toggleSort('updated')}>
                    Last Updated {sortIndicator(sort, 'updated')}
                  </button>
                </th>
                <th style={{ width: 32 }}></th>
              </tr>
            </thead>
            <tbody>
              {fetching && (
                <tr><td colSpan={6} className="crm-table__empty">Loading…</td></tr>
              )}
              {!fetching && orgs.length === 0 && (
                <tr><td colSpan={6} className="crm-table__empty">No prospects yet. Add one to get started.</td></tr>
              )}
              {sortedOrgs.map((o) => (
                <tr
                  key={o.organisation_id}
                  className="crm-table__row--clickable"
                  onClick={() => navigate(`/platform/crm/organisations/${o.organisation_id}`)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/platform/crm/organisations/${o.organisation_id}`)}
                >
                  <td className="crm-table__primary">
                    <div className="platform-clients-table__company-cell">
                      {o.logo_filename ? (
                        <span className="platform-clients-table__logo-slot" aria-hidden>
                          <AuthenticatedBlobImage
                            path={`/api/platform/crm/organisations/${o.organisation_id}/logo`}
                            alt=""
                            className="platform-clients-table__logo"
                          />
                        </span>
                      ) : null}
                      <span>{o.organisation_name}</span>
                      {o.do_not_contact && (
                        <span className="badge badge-closed" style={{ marginLeft: '0.4rem' }}>
                          Do not contact
                        </span>
                      )}
                    </div>
                  </td>
                  <td><span className={LEAD_STATUS_BADGE[o.lead_status] || 'badge'}>{o.lead_status}</span></td>
                  <td>{o.business_unit}</td>
                  <td>{o.industry || '—'}</td>
                  <td>{fmtDate(o.updated_at)}</td>
                  <td><ChevronRight size={16} strokeWidth={2} color="var(--muted)" aria-hidden /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {createOpen && (
        <div className="modal-backdrop">
          <div className="modal-dialog modal-dialog--wide card" role="dialog" aria-modal aria-labelledby="create-org-title">
            <div className="modal-dialog__head">
              <h2 id="create-org-title" style={{ fontSize: '1.15rem', fontWeight: 700 }}>New Prospect</h2>
              <button type="button" className="btn btn-ghost modal-dialog__close" onClick={() => setCreateOpen(false)} aria-label="Close">
                <X size={22} aria-hidden />
              </button>
            </div>
            <form onSubmit={create} style={{ marginTop: '1rem' }}>
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
                  <label htmlFor="org-source">Lead Origin</label>
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

      {customFieldsOrg && (
        <div className="modal-backdrop">
          <div className="modal-dialog card" role="dialog" aria-modal aria-labelledby="skate-fields-title">
            <div className="modal-dialog__head">
              <h2 id="skate-fields-title" style={{ fontSize: '1.15rem', fontWeight: 700 }}>
                {customFieldsOrg.business_unit} details
              </h2>
              <button type="button" className="btn btn-ghost modal-dialog__close" onClick={goToCreatedOrg} aria-label="Close">
                <X size={22} aria-hidden />
              </button>
            </div>
            <p className="muted" style={{ fontSize: '0.9rem', marginTop: '0.25rem' }}>
              {customFieldsOrg.organisation_name} was created. Add its {customFieldsOrg.business_unit} details now, or skip and fill them in later from Configurations.
            </p>
            <form onSubmit={saveCustomFieldsAndContinue} style={{ marginTop: '0.75rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                {(BUSINESS_UNIT_CUSTOM_FIELDS[customFieldsOrg.business_unit] || []).map((field) => (
                  <div className="field" key={field.key}>
                    <label htmlFor={`skate-field-${field.key}`}>{field.label}</label>
                    {field.type === 'select' ? (
                      <select
                        id={`skate-field-${field.key}`}
                        value={customFieldsForm[field.key] || ''}
                        onChange={(e) => setCustomFieldsForm((p) => ({ ...p, [field.key]: e.target.value }))}
                      >
                        <option value="">—</option>
                        {field.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : (
                      <input
                        id={`skate-field-${field.key}`}
                        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                        value={customFieldsForm[field.key] ?? ''}
                        onChange={(e) => setCustomFieldsForm((p) => ({ ...p, [field.key]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="modal-dialog__actions">
                <button className="btn btn-ghost" type="button" onClick={goToCreatedOrg} disabled={customFieldsBusy}>
                  Skip for now
                </button>
                <button className="btn btn-primary" type="submit" disabled={customFieldsBusy}>
                  {customFieldsBusy ? 'Saving…' : 'Save details'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
