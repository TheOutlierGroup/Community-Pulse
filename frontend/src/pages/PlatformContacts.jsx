import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, ChevronUp, ChevronDown, ChevronsUpDown, X, ArrowUpRight, Mail, Phone, BookmarkPlus, User, Users2, Upload, Sparkles, AlertTriangle } from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import Layout from '../components/shared/Layout.jsx';
import { BUSINESS_UNITS, businessUnitBadgeClass } from '../config/crmConstants.js';
import {
  RELATIONSHIP_STATUS_OPTIONS,
  normalizeRelationshipStatus,
  relationshipStatusLabel,
  relationshipStatusBadgeClass,
} from './platformClientUtils.js';
import { applyCustomFilter, customFilterReach, describeCustomFilter, CONTACT_SOURCE_OPTIONS } from '../utils/customFilters.js';
import { parseCsv, mapImportRows, looksLikeSource } from '../utils/contactImportCsv.js';
import '../styles/crm.css';

const IMPORT_SOURCE_LABELS = { manual: 'Manual', linkedin: 'LinkedIn', firmable: 'Firmable' };
const MAX_IMPORT_ROWS = 5000;

function sourceLabel(id) {
  return CONTACT_SOURCE_OPTIONS.find((o) => o.id === id)?.label || IMPORT_SOURCE_LABELS[id] || 'Manual';
}

const LINK_TYPE_OPTIONS = [
  { value: '', label: 'All contacts' },
  { value: 'prospect', label: 'Linked to a prospect' },
  { value: 'client', label: 'Linked to a client' },
  { value: 'unlinked', label: 'Unlinked' },
];

const EMPTY_FORM = {
  contact_firstname: '', contact_lastname: '', contact_email: '', contact_phone: '', contact_role: '',
  relationship_status: 'new', crm_organisation_id: '', client_organization_id: '',
};

// Same 3-state sort cycle as the Prospects/Clients tables: default ->
// ascending -> descending -> default (most-recently-updated-first).
const SORTABLE_COLUMNS = {
  name: (c) => `${c.contact_firstname || ''} ${c.contact_lastname || ''}`.trim(),
  role: (c) => String(c.contact_role || ''),
  linked: (c) => String(c.client_name || c.prospect_name || ''),
  status: (c) => relationshipStatusLabel(c.relationship_status),
  updated: (c) => new Date(c.updated_at || 0).getTime(),
};

function nextSortState(current, column) {
  if (current.column !== column) return { column, direction: 'asc' };
  if (current.direction === 'asc') return { column, direction: 'desc' };
  return { column: null, direction: null };
}

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

function ContactFormFields({ form, setForm, prospects, clients }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0.75rem' }}>
        <div className="field">
          <label>First name *</label>
          <input value={form.contact_firstname} onChange={(e) => setForm((p) => ({ ...p, contact_firstname: e.target.value }))} required autoFocus />
        </div>
        <div className="field">
          <label>Last name</label>
          <input value={form.contact_lastname} onChange={(e) => setForm((p) => ({ ...p, contact_lastname: e.target.value }))} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0.75rem' }}>
        <div className="field">
          <label>Email</label>
          <input type="email" value={form.contact_email} onChange={(e) => setForm((p) => ({ ...p, contact_email: e.target.value }))} />
        </div>
        <div className="field">
          <label>Phone</label>
          <input type="tel" value={form.contact_phone} onChange={(e) => setForm((p) => ({ ...p, contact_phone: e.target.value }))} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0.75rem' }}>
        <div className="field">
          <label>Role / title</label>
          <input value={form.contact_role} onChange={(e) => setForm((p) => ({ ...p, contact_role: e.target.value }))} />
        </div>
        <div className="field">
          <label>Relationship status</label>
          <select
            value={form.relationship_status}
            onChange={(e) => setForm((p) => ({ ...p, relationship_status: e.target.value }))}
          >
            {RELATIONSHIP_STATUS_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0.75rem' }}>
        <div className="field">
          <label>Link to prospect</label>
          <select
            value={form.crm_organisation_id}
            onChange={(e) => setForm((p) => ({ ...p, crm_organisation_id: e.target.value }))}
          >
            <option value="">— None —</option>
            {prospects.map((p) => (
              <option key={p.organisation_id} value={p.organisation_id}>{p.organisation_name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Link to client</label>
          <select
            value={form.client_organization_id}
            onChange={(e) => setForm((p) => ({ ...p, client_organization_id: e.target.value }))}
          >
            <option value="">— None —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="muted" style={{ fontSize: '0.82rem', margin: '0.25rem 0 0' }}>
        Leave both unset for a standalone contact — e.g. someone who left an org but is still a warm lead, or a referral who could introduce you elsewhere.
      </p>
    </>
  );
}

export default function PlatformContacts() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const ok = usePlatformAccess(user, loading, navigate);
  const { showToast } = useToast();

  const isAdmin = user?.role === 'admin';

  const [contacts, setContacts] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [search, setSearch] = useState('');
  const [linkType, setLinkType] = useState('');
  const [buFilter, setBuFilter] = useState('');
  const [sort, setSort] = useState({ column: null, direction: null });

  const [customFilters, setCustomFilters] = useState([]);
  const [personalLimit, setPersonalLimit] = useState(-1);
  const [selectedFilterId, setSelectedFilterId] = useState('');

  const [filtersManagerOpen, setFiltersManagerOpen] = useState(false);
  const [saveFilterForm, setSaveFilterForm] = useState({ name: '', scope: 'personal' });
  const [saveFilterBusy, setSaveFilterBusy] = useState(false);
  const [saveFilterError, setSaveFilterError] = useState('');

  const [prospects, setProspects] = useState([]);
  const [clients, setClients] = useState([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');

  const [editContact, setEditContact] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');

  const [importOpen, setImportOpen] = useState(false);
  const [importSource, setImportSource] = useState('linkedin');
  const [importParsed, setImportParsed] = useState(null);
  const [importFileName, setImportFileName] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const [importResult, setImportResult] = useState(null);

  useDocumentTitle(!loading && ok ? `Contacts | ${DEFAULT_TAB}` : null);

  const load = useCallback(async () => {
    setFetching(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (linkType) params.linkType = linkType;
      if (buFilter) params.businessUnit = buFilter;
      const { data } = await api.get('/api/platform/contacts', { params });
      setContacts(data.contacts || []);
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to load contacts.', { variant: 'error' });
    } finally {
      setFetching(false);
    }
  }, [search, linkType, buFilter, showToast]);

  useEffect(() => { if (ok) load(); }, [ok, load]);

  const loadCustomFilters = useCallback(() => {
    api.get('/api/platform/custom-filters')
      .then(({ data }) => {
        setCustomFilters(data.customFilters || []);
        setPersonalLimit(Number.isFinite(data.personalLimit) ? data.personalLimit : -1);
      })
      .catch(() => setCustomFilters([]));
  }, []);

  useEffect(() => {
    if (!ok) return;
    loadCustomFilters();
    api.get('/api/platform/crm/organisations', { params: { limit: 500, includePromoted: true } })
      .then(({ data }) => setProspects(data.organisations || []))
      .catch(() => setProspects([]));
    api.get('/api/platform/organizations')
      .then(({ data }) => setClients((data.organizations || []).filter((o) => o.kind === 'client')))
      .catch(() => setClients([]));
  }, [ok, loadCustomFilters]);

  // Deep link from a campaign stage's WHO chip: ?customFilter=<id> preselects
  // that filter once the list has loaded, then clears the param so a manual
  // "Clear" sticks.
  useEffect(() => {
    const wanted = searchParams.get('customFilter');
    if (!wanted || customFilters.length === 0) return;
    if (customFilters.some((f) => String(f.filter_id) === String(wanted))) {
      setSelectedFilterId(String(wanted));
    }
    searchParams.delete('customFilter');
    setSearchParams(searchParams, { replace: true });
  }, [customFilters, searchParams, setSearchParams]);

  const selectedFilter = useMemo(
    () => customFilters.find((f) => String(f.filter_id) === String(selectedFilterId)) || null,
    [customFilters, selectedFilterId],
  );

  // The selected custom filter filters the loaded rows client-side (the manual
  // dataset is small today; this moves server-side with real counts once CSV
  // import lands and volumes grow).
  const visibleContacts = useMemo(
    () => (selectedFilter ? applyCustomFilter(contacts, selectedFilter.definition) : contacts),
    [contacts, selectedFilter],
  );

  const reach = useMemo(() => customFilterReach(visibleContacts), [visibleContacts]);

  const sharedFilters = customFilters.filter((f) => f.scope === 'shared');
  const personalFilters = customFilters.filter((f) => f.scope === 'personal');
  const hasPersonalLimit = personalLimit >= 0;
  const personalFull = hasPersonalLimit && personalFilters.length >= personalLimit;

  function toggleSort(column) {
    setSort((current) => nextSortState(current, column));
  }

  const sortedContacts = useMemo(() => {
    const activeColumn = sort.column || 'updated';
    const direction = sort.column ? sort.direction : 'desc';
    const dirMultiplier = direction === 'asc' ? 1 : -1;
    const getValue = SORTABLE_COLUMNS[activeColumn];
    return [...visibleContacts].sort((a, b) => {
      const av = getValue(a);
      const bv = getValue(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dirMultiplier;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * dirMultiplier;
    });
  }, [visibleContacts, sort]);

  function patchContactLocal(contactId, patch) {
    setContacts((prev) => prev.map((c) => (c.contact_id === contactId ? { ...c, ...patch } : c)));
  }

  async function createContact(e) {
    e.preventDefault();
    if (!createForm.contact_firstname.trim()) { setCreateError('First name is required.'); return; }
    setCreateBusy(true); setCreateError('');
    try {
      await api.post('/api/platform/contacts', createForm);
      showToast('Contact added.', { variant: 'success' });
      setCreateOpen(false);
      setCreateForm(EMPTY_FORM);
      load();
    } catch (e) {
      setCreateError(e.response?.data?.error || 'Failed to create contact.');
    } finally {
      setCreateBusy(false);
    }
  }

  function openEdit(contact) {
    setEditContact(contact);
    setEditForm({
      contact_firstname: contact.contact_firstname || '',
      contact_lastname: contact.contact_lastname || '',
      contact_email: contact.contact_email || '',
      contact_phone: contact.contact_phone || '',
      contact_role: contact.contact_role || '',
      relationship_status: normalizeRelationshipStatus(contact.relationship_status),
      crm_organisation_id: contact.crm_organisation_id ? String(contact.crm_organisation_id) : '',
      client_organization_id: contact.client_organization_id || '',
    });
    setEditError('');
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editForm.contact_firstname.trim()) { setEditError('First name is required.'); return; }
    setEditBusy(true); setEditError('');
    try {
      await api.patch(`/api/platform/contacts/${editContact.contact_id}`, editForm);
      showToast('Contact updated.', { variant: 'success' });
      setEditContact(null);
      load();
    } catch (e) {
      setEditError(e.response?.data?.error || 'Failed to update contact.');
    } finally {
      setEditBusy(false);
    }
  }

  async function deleteContact() {
    if (!window.confirm(`Delete ${editContact.contact_firstname} ${editContact.contact_lastname || ''}?`.trim() + '?')) return;
    setEditBusy(true);
    try {
      await api.delete(`/api/platform/contacts/${editContact.contact_id}`);
      showToast('Contact deleted.', { variant: 'success' });
      setEditContact(null);
      load();
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to delete contact.', { variant: 'error' });
    } finally {
      setEditBusy(false);
    }
  }

  function openImport() {
    setImportSource('linkedin');
    setImportParsed(null);
    setImportFileName('');
    setImportError('');
    setImportResult(null);
    setImportOpen(true);
  }

  async function onImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    setImportResult(null);
    setImportFileName(file.name);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.rows.length === 0) {
        setImportParsed(null);
        setImportError('No data rows found in that file.');
        return;
      }
      setImportParsed(parsed);
    } catch {
      setImportParsed(null);
      setImportError('Could not read that file.');
    }
  }

  async function runImport() {
    if (!importParsed) return;
    const rows = mapImportRows(importParsed, importSource);
    if (rows.length > MAX_IMPORT_ROWS) {
      setImportError(`This file has ${rows.length} rows. Import up to ${MAX_IMPORT_ROWS} at a time — split it into smaller files.`);
      return;
    }
    setImportBusy(true);
    setImportError('');
    try {
      const { data } = await api.post('/api/platform/contacts/import', { source: importSource, rows });
      setImportResult(data.summary);
      showToast('Import complete.', { variant: 'success' });
      load();
      loadCustomFilters();
    } catch (err) {
      setImportError(err.response?.data?.error || 'Import failed.');
    } finally {
      setImportBusy(false);
    }
  }

  function openFiltersManager() {
    setSaveFilterForm({ name: '', scope: isAdmin ? 'shared' : 'personal' });
    setSaveFilterError('');
    setFiltersManagerOpen(true);
  }

  async function saveCustomFilter(e) {
    e.preventDefault();
    if (!saveFilterForm.name.trim()) { setSaveFilterError('A custom filter name is required.'); return; }
    // Warn before creating a shared filter — it becomes visible to everyone.
    if (saveFilterForm.scope === 'shared') {
      const okShared = window.confirm(
        'Create a shared custom filter?\n\nShared filters are visible to everyone in the workspace and can be targeted by any campaign.',
      );
      if (!okShared) return;
    }
    setSaveFilterBusy(true); setSaveFilterError('');
    try {
      // Snapshot the current filter bar as the custom filter's definition.
      const { data } = await api.post('/api/platform/custom-filters', {
        name: saveFilterForm.name.trim(),
        scope: saveFilterForm.scope,
        definition: { search, linkType, businessUnit: buFilter },
      });
      showToast('Custom filter saved.', { variant: 'success' });
      setSaveFilterForm((p) => ({ ...p, name: '' }));
      loadCustomFilters();
      if (data?.customFilter?.filter_id) setSelectedFilterId(String(data.customFilter.filter_id));
    } catch (err) {
      setSaveFilterError(err.response?.data?.error || 'Failed to save custom filter.');
    } finally {
      setSaveFilterBusy(false);
    }
  }

  async function deleteCustomFilter(filter) {
    if (!window.confirm(`Delete custom filter "${filter.name}"?`)) return;
    try {
      await api.delete(`/api/platform/custom-filters/${filter.filter_id}`);
      showToast('Custom filter deleted.', { variant: 'success' });
      if (String(selectedFilterId) === String(filter.filter_id)) setSelectedFilterId('');
      loadCustomFilters();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to delete custom filter.', { variant: 'error' });
    }
  }

  function LinkBadges({ contact }) {
    const badges = [];
    if (contact.client_organization_id) {
      badges.push(
        <button
          key="client"
          type="button"
          className={`badge ${businessUnitBadgeClass(contact.client_business_unit)} badge--link`}
          title={contact.client_name || 'Client'}
          onClick={(e) => { e.stopPropagation(); navigate(`/platform/clients/${contact.client_organization_id}`); }}
        >
          <span className="badge--link__label">{contact.client_name || 'Client'}</span>
          <ArrowUpRight size={11} strokeWidth={2} aria-hidden style={{ flexShrink: 0 }} />
        </button>
      );
    }
    if (contact.crm_organisation_id) {
      badges.push(
        <button
          key="prospect"
          type="button"
          className={`badge ${businessUnitBadgeClass(contact.prospect_business_unit)} badge--link`}
          title={contact.prospect_name || 'Prospect'}
          onClick={(e) => { e.stopPropagation(); navigate(`/platform/crm/organisations/${contact.crm_organisation_id}`); }}
        >
          <span className="badge--link__label">{contact.prospect_name || 'Prospect'}</span>
          <ArrowUpRight size={11} strokeWidth={2} aria-hidden style={{ flexShrink: 0 }} />
        </button>
      );
    }
    if (badges.length === 0) {
      return <span className="badge">Unlinked</span>;
    }
    return <div style={{ display: 'inline-flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'center' }}>{badges}</div>;
  }

  function RelationshipStatusCell({ contact }) {
    const [editing, setEditing] = useState(false);
    const [busy, setBusy] = useState(false);

    async function changeStatus(value) {
      setBusy(true);
      try {
        await api.patch(`/api/platform/contacts/${contact.contact_id}`, { relationship_status: value });
        patchContactLocal(contact.contact_id, { relationship_status: value });
        showToast('Relationship status updated.', { variant: 'success' });
      } catch (err) {
        showToast(err.response?.data?.error || 'Failed to update relationship status.', { variant: 'error' });
      } finally {
        setBusy(false);
        setEditing(false);
      }
    }

    if (editing) {
      return (
        <select
          autoFocus
          value={normalizeRelationshipStatus(contact.relationship_status)}
          onChange={(e) => changeStatus(e.target.value)}
          onBlur={() => setEditing(false)}
          onClick={(e) => e.stopPropagation()}
          disabled={busy}
          style={{ fontSize: '0.78rem', padding: '0.2rem 0.4rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
        >
          {RELATIONSHIP_STATUS_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      );
    }

    return (
      <button
        type="button"
        className={`badge ${relationshipStatusBadgeClass(contact.relationship_status)} badge--link`}
        style={{ maxWidth: 140 }}
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        disabled={busy}
      >
        {relationshipStatusLabel(contact.relationship_status)}
      </button>
    );
  }

  function EnrichmentPanel({ contact }) {
    if (!contact) return null;
    const sources = Array.isArray(contact.enrichment_sources) ? contact.enrichment_sources : [];
    const enr = contact.enrichment && typeof contact.enrichment === 'object' ? contact.enrichment : {};
    const li = enr.linkedin || {};
    const fb = enr.firmable || {};
    const facts = [];
    const push = (label, val) => { if (val) facts.push([label, String(val)]); };
    push('Company', fb.company_name || li.company);
    push('Headline', fb.headline);
    push('Industry', li.industry);
    push('Company industries', fb.company_industries);
    push('Employee count', fb.employee_count_range);
    push('Department', fb.department);
    push('Location', li.location || [fb.suburb, fb.state, fb.country].filter(Boolean).join(', '));
    push('Connected on', li.connected_on);
    push('Connections', fb.connections);
    push('Followers', fb.followers);
    if (fb.dnc_mobile === 'true') push('Mobile DNC', 'Yes — do not call');
    push('Firmable list', fb.list);

    if (sources.length === 0 && (contact.source || 'manual') === 'manual' && facts.length === 0) return null;

    return (
      <div className="enrichment-panel">
        <div className="enrichment-panel__head">
          <span className="enrichment-panel__title"><Sparkles size={14} strokeWidth={2} aria-hidden /> Enrichment</span>
          <span className="badge" title="How this contact entered the CRM">{sourceLabel(contact.source)}</span>
          {sources.includes('linkedin') && <span className="badge badge-channel">LinkedIn enriched</span>}
          {sources.includes('firmable') && <span className="badge badge-active">Firmable enriched</span>}
        </div>
        {facts.length > 0 && (
          <dl className="enrichment-facts">
            {facts.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        )}
        {contact.linkedin_url && (
          <a className="enrichment-panel__link" href={`https://www.linkedin.com/in/${contact.linkedin_url}`} target="_blank" rel="noreferrer">
            View LinkedIn profile <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
          </a>
        )}
      </div>
    );
  }

  if (!ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <div className="app-main">
        <div className="crm-page-header">
          <h1>Contacts</h1>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-ghost" onClick={openImport}>
              <Upload size={18} strokeWidth={2} aria-hidden /> Import
            </button>
            <button className="btn btn-primary" onClick={() => { setCreateForm(EMPTY_FORM); setCreateError(''); setCreateOpen(true); }}>
              <Plus size={18} strokeWidth={2} aria-hidden /> Add contact
            </button>
          </div>
        </div>

        <div className="crm-filter-bar">
          <input
            type="search" placeholder="Search contacts…" value={search}
            onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 220 }}
          />
          <select value={linkType} onChange={(e) => setLinkType(e.target.value)}>
            {LINK_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={buFilter} onChange={(e) => setBuFilter(e.target.value)}>
            <option value="">All business units</option>
            {BUSINESS_UNITS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select
            value={selectedFilterId}
            onChange={(e) => setSelectedFilterId(e.target.value)}
            aria-label="Custom filter"
            title="Apply a saved custom filter"
          >
            <option value="">No custom filter</option>
            {sharedFilters.length > 0 && (
              <optgroup label="Shared">
                {sharedFilters.map((f) => <option key={f.filter_id} value={f.filter_id}>{f.name}</option>)}
              </optgroup>
            )}
            {personalFilters.length > 0 && (
              <optgroup label="Personal">
                {personalFilters.map((f) => <option key={f.filter_id} value={f.filter_id}>{f.name}</option>)}
              </optgroup>
            )}
          </select>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={openFiltersManager}
            title="Save the current filters, and manage your custom filters"
          >
            <BookmarkPlus size={16} strokeWidth={2} aria-hidden /> Custom filters
          </button>
        </div>

        {selectedFilter && (
          <div className="custom-filter-summary" role="status">
            <span className="custom-filter-summary__name">{selectedFilter.name}</span>
            <span className="custom-filter-summary__desc muted">{describeCustomFilter(selectedFilter.definition)}</span>
            <span className="custom-filter-summary__spacer" />
            <span className="badge" title="Contacts currently in this custom filter">{reach.total} contacts</span>
            <span className="badge badge-open" title="Reachable by email">
              <Mail size={12} strokeWidth={2} aria-hidden /> {reach.email} email
            </span>
            <span className="badge" title="Have a phone number">
              <Phone size={12} strokeWidth={2} aria-hidden /> {reach.phone} phone
            </span>
            <button type="button" className="btn btn-ghost" onClick={() => setSelectedFilterId('')} aria-label="Clear custom filter">
              <X size={15} aria-hidden /> Clear
            </button>
          </div>
        )}

        <div className="table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th aria-sort={ariaSortFor(sort, 'name')}>
                  <button type="button" className="crm-table__sort-btn" onClick={() => toggleSort('name')}>
                    Name {sortIndicator(sort, 'name')}
                  </button>
                </th>
                <th aria-sort={ariaSortFor(sort, 'status')}>
                  <button type="button" className="crm-table__sort-btn" onClick={() => toggleSort('status')}>
                    Relationship status {sortIndicator(sort, 'status')}
                  </button>
                </th>
                <th aria-sort={ariaSortFor(sort, 'role')}>
                  <button type="button" className="crm-table__sort-btn" onClick={() => toggleSort('role')}>
                    Recent Role {sortIndicator(sort, 'role')}
                  </button>
                </th>
                <th aria-sort={ariaSortFor(sort, 'linked')}>
                  <button type="button" className="crm-table__sort-btn" onClick={() => toggleSort('linked')}>
                    Recent Organisation {sortIndicator(sort, 'linked')}
                  </button>
                </th>
                <th>Email</th>
                <th>Phone</th>
              </tr>
            </thead>
            <tbody>
              {fetching && (
                <tr><td colSpan={6} className="crm-table__empty">Loading…</td></tr>
              )}
              {!fetching && visibleContacts.length === 0 && (
                <tr><td colSpan={6} className="crm-table__empty">
                  {selectedFilter ? 'No contacts match this custom filter.' : 'No contacts yet.'}
                </td></tr>
              )}
              {sortedContacts.map((c) => (
                <tr
                  key={c.contact_id}
                  className="crm-table__row--clickable"
                  onClick={() => openEdit(c)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && openEdit(c)}
                >
                  <td className="crm-table__primary">
                    {c.contact_firstname} {c.contact_lastname}
                  </td>
                  <td><RelationshipStatusCell contact={c} /></td>
                  <td>{c.contact_role || '—'}</td>
                  <td style={{ textAlign: 'center' }}><LinkBadges contact={c} /></td>
                  <td>{c.contact_email || '—'}</td>
                  <td>{c.contact_phone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {createOpen && (
        <div className="modal-backdrop">
          <div className="modal-dialog modal-dialog--wide card" role="dialog" aria-modal aria-labelledby="create-contact-title">
            <div className="modal-dialog__head">
              <h2 id="create-contact-title" style={{ fontSize: '1.15rem', fontWeight: 700 }}>Add contact</h2>
              <button type="button" className="btn btn-ghost modal-dialog__close" onClick={() => setCreateOpen(false)} aria-label="Close">
                <X size={22} aria-hidden />
              </button>
            </div>
            <form onSubmit={createContact} style={{ marginTop: '1rem' }}>
              <ContactFormFields form={createForm} setForm={setCreateForm} prospects={prospects} clients={clients} />
              {createError && <p className="error">{createError}</p>}
              <div className="modal-dialog__actions">
                <button className="btn btn-ghost" type="button" onClick={() => setCreateOpen(false)}>Cancel</button>
                <button className="btn btn-primary" type="submit" disabled={createBusy}>{createBusy ? 'Adding…' : 'Add contact'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editContact && (
        <div className="modal-backdrop">
          <div className="modal-dialog modal-dialog--wide card" role="dialog" aria-modal aria-labelledby="edit-contact-title">
            <div className="modal-dialog__head">
              <h2 id="edit-contact-title" style={{ fontSize: '1.15rem', fontWeight: 700 }}>Edit contact</h2>
              <button type="button" className="btn btn-ghost modal-dialog__close" onClick={() => setEditContact(null)} aria-label="Close">
                <X size={22} aria-hidden />
              </button>
            </div>
            <EnrichmentPanel contact={editContact} />
            <form onSubmit={saveEdit} style={{ marginTop: '1rem' }}>
              <ContactFormFields form={editForm} setForm={setEditForm} prospects={prospects} clients={clients} />
              {editError && <p className="error">{editError}</p>}
              <div className="modal-dialog__actions" style={{ justifyContent: 'space-between' }}>
                <button
                  type="button"
                  className="btn"
                  style={{ backgroundColor: 'var(--danger, #dc3545)', color: '#fff', border: 'none' }}
                  onClick={deleteContact}
                  disabled={editBusy}
                >
                  Delete
                </button>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn btn-ghost" type="button" onClick={() => setEditContact(null)} disabled={editBusy}>Cancel</button>
                  <button className="btn btn-primary" type="submit" disabled={editBusy}>{editBusy ? 'Saving…' : 'Save'}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {filtersManagerOpen && (
        <div className="modal-backdrop">
          <div className="modal-dialog modal-dialog--custom-filter card" role="dialog" aria-modal aria-labelledby="custom-filters-title">
            <div className="modal-dialog__head">
              <h2 id="custom-filters-title" style={{ fontSize: '1.15rem', fontWeight: 700 }}>Custom filters</h2>
              <button type="button" className="btn btn-ghost modal-dialog__close" onClick={() => setFiltersManagerOpen(false)} aria-label="Close">
                <X size={22} aria-hidden />
              </button>
            </div>

            {hasPersonalLimit && (
              <div className="custom-filter-tracker" role="status" style={{ marginTop: '0.75rem' }}>
                <span>{personalFilters.length} of {personalLimit} personal custom filters used</span>
                <span className="custom-filter-tracker__meter" aria-hidden>
                  <span style={{ width: `${Math.min(100, (personalFilters.length / personalLimit) * 100)}%` }} />
                </span>
                {personalFull && <span className="custom-filter-tracker__full">Limit reached — delete one to add another.</span>}
              </div>
            )}

            <form onSubmit={saveCustomFilter} style={{ marginTop: '1rem' }}>
              <p className="muted" style={{ marginTop: 0 }}>
                Save the current filters as a reusable custom filter: <strong>{describeCustomFilter({ search, linkType, businessUnit: buFilter })}</strong>.
                {isAdmin ? ' You can fine-tune its rules later in Settings → Custom Filters.' : ''}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0.75rem' }}>
                <div className="field">
                  <label htmlFor="save-filter-name">Name *</label>
                  <input id="save-filter-name" value={saveFilterForm.name} onChange={(e) => setSaveFilterForm((p) => ({ ...p, name: e.target.value }))} required autoFocus />
                </div>
                <div className="field">
                  <label htmlFor="save-filter-scope">Visibility</label>
                  <select
                    id="save-filter-scope"
                    value={saveFilterForm.scope}
                    onChange={(e) => setSaveFilterForm((p) => ({ ...p, scope: e.target.value }))}
                  >
                    {isAdmin && <option value="shared">Shared — everyone in the workspace</option>}
                    <option value="personal">Personal — only me</option>
                  </select>
                </div>
              </div>
              {saveFilterError && <p className="error">{saveFilterError}</p>}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={saveFilterBusy || (saveFilterForm.scope === 'personal' && personalFull)}
                >
                  {saveFilterBusy ? 'Saving…' : 'Save current filters'}
                </button>
              </div>
            </form>

            {(personalFilters.length > 0 || sharedFilters.length > 0) && (
              <div style={{ marginTop: '1.25rem' }}>
                <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem' }}>Your custom filters</h3>
                <ul className="custom-filter-list">
                  {personalFilters.map((f) => (
                    <li key={f.filter_id}>
                      <div className="custom-filter-list__main">
                        <span className="custom-filter-list__name">{f.name}</span>
                        <span className="badge"><User size={11} aria-hidden /> Personal</span>
                        <span className="muted custom-filter-list__desc">{describeCustomFilter(f.definition)}</span>
                      </div>
                      <button type="button" className="btn btn-ghost" onClick={() => deleteCustomFilter(f)}>Delete</button>
                    </li>
                  ))}
                  {sharedFilters.map((f) => (
                    <li key={f.filter_id}>
                      <div className="custom-filter-list__main">
                        <span className="custom-filter-list__name">{f.name}</span>
                        <span className="badge badge-active"><Users2 size={11} aria-hidden /> Shared</span>
                        <span className="muted custom-filter-list__desc">{describeCustomFilter(f.definition)}</span>
                      </div>
                      {isAdmin
                        ? <button type="button" className="btn btn-ghost" onClick={() => deleteCustomFilter(f)}>Delete</button>
                        : <span className="muted" style={{ fontSize: '0.8rem' }}>Admin-managed</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="modal-dialog__actions">
              <button className="btn btn-ghost" type="button" onClick={() => setFiltersManagerOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="modal-backdrop">
          <div className="modal-dialog modal-dialog--custom-filter card" role="dialog" aria-modal aria-labelledby="import-title">
            <div className="modal-dialog__head">
              <h2 id="import-title" style={{ fontSize: '1.15rem', fontWeight: 700 }}>Import contacts</h2>
              <button type="button" className="btn btn-ghost modal-dialog__close" onClick={() => setImportOpen(false)} aria-label="Close"><X size={22} aria-hidden /></button>
            </div>

            {importResult ? (
              <div style={{ marginTop: '1rem' }}>
                <p style={{ marginTop: 0 }}>Import complete — <strong>{sourceLabel(importResult.source)}</strong>, {importResult.totalRows} rows.</p>
                <div className="import-summary">
                  {importResult.source === 'linkedin' && <div><span className="import-summary__n">{importResult.created}</span> created</div>}
                  <div><span className="import-summary__n">{importResult.updated}</span> {importResult.source === 'firmable' ? 'enriched' : 'updated'}</div>
                  {importResult.source === 'firmable' && <div><span className="import-summary__n">{importResult.ignored}</span> ignored (no match)</div>}
                  {importResult.skipped > 0 && <div><span className="import-summary__n">{importResult.skipped}</span> skipped (no name / URL)</div>}
                </div>
                {importResult.source === 'firmable' && importResult.ignored > 0 && (
                  <p className="muted" style={{ fontSize: '0.83rem' }}>
                    Firmable only enriches contacts you already have — unmatched rows are ignored until that person becomes a LinkedIn contact.
                  </p>
                )}
                <div className="modal-dialog__actions">
                  <button className="btn btn-ghost" type="button" onClick={() => { setImportResult(null); setImportParsed(null); setImportFileName(''); }}>Import another file</button>
                  <button className="btn btn-primary" type="button" onClick={() => setImportOpen(false)}>Done</button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: '1rem' }}>
                <div className="field">
                  <label>Source</label>
                  <div className="pulse-template-mode-switch" role="tablist" aria-label="Import source" style={{ marginBottom: 0 }}>
                    {[['linkedin', 'LinkedIn (MeetAlfred)'], ['firmable', 'Firmable']].map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={importSource === id}
                        className={`pulse-template-mode-switch__pill${importSource === id ? ' pulse-template-mode-switch__pill--active' : ''}`}
                        onClick={() => setImportSource(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="muted" style={{ fontSize: '0.82rem', margin: '0.5rem 0 0' }}>
                    {importSource === 'linkedin'
                      ? 'LinkedIn contacts are created and updated, matched by LinkedIn URL (then name). Your manual edits are never overwritten.'
                      : 'Firmable enriches contacts you already have (matched by LinkedIn URL, then name). Unmatched rows are ignored — it never creates new contacts.'}
                  </p>
                </div>

                <div className="field">
                  <label htmlFor="import-file">CSV file</label>
                  <input id="import-file" type="file" accept=".csv,text/csv" onChange={onImportFile} />
                </div>

                {importParsed && (
                  <div className="import-preview">
                    <p style={{ margin: 0 }}><strong>{importParsed.rows.length}</strong> rows parsed from <code>{importFileName}</code>.</p>
                    {!looksLikeSource(importParsed, importSource) && (
                      <div className="inline-warning" role="alert" style={{ marginTop: '0.5rem' }}>
                        <AlertTriangle size={16} strokeWidth={2} aria-hidden />
                        <span>This file doesn’t look like a {sourceLabel(importSource)} export — expected columns weren’t found. Double-check the source before importing.</span>
                      </div>
                    )}
                    {importParsed.rows.length > MAX_IMPORT_ROWS && (
                      <div className="inline-warning" role="alert" style={{ marginTop: '0.5rem' }}>
                        <AlertTriangle size={16} strokeWidth={2} aria-hidden />
                        <span>Over the {MAX_IMPORT_ROWS.toLocaleString()}-row limit — split this file into smaller batches.</span>
                      </div>
                    )}
                  </div>
                )}

                {importError && <p className="error">{importError}</p>}

                <div className="modal-dialog__actions">
                  <button className="btn btn-ghost" type="button" onClick={() => setImportOpen(false)} disabled={importBusy}>Cancel</button>
                  <button className="btn btn-primary" type="button" onClick={runImport} disabled={importBusy || !importParsed || importParsed.rows.length > MAX_IMPORT_ROWS}>
                    {importBusy ? 'Importing…' : `Import ${importParsed ? `${Math.min(importParsed.rows.length, MAX_IMPORT_ROWS)} ` : ''}contacts`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
