import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ChevronUp, ChevronDown, ChevronsUpDown, X, ArrowUpRight } from 'lucide-react';
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
import '../styles/crm.css';

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
  const ok = usePlatformAccess(user, loading, navigate);
  const { showToast } = useToast();

  const [contacts, setContacts] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [search, setSearch] = useState('');
  const [linkType, setLinkType] = useState('');
  const [buFilter, setBuFilter] = useState('');
  const [sort, setSort] = useState({ column: null, direction: null });

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

  useEffect(() => {
    if (!ok) return;
    api.get('/api/platform/crm/organisations', { params: { limit: 500, includePromoted: true } })
      .then(({ data }) => setProspects(data.organisations || []))
      .catch(() => setProspects([]));
    api.get('/api/platform/organizations')
      .then(({ data }) => setClients((data.organizations || []).filter((o) => o.kind === 'client')))
      .catch(() => setClients([]));
  }, [ok]);

  function toggleSort(column) {
    setSort((current) => nextSortState(current, column));
  }

  const sortedContacts = useMemo(() => {
    const activeColumn = sort.column || 'updated';
    const direction = sort.column ? sort.direction : 'desc';
    const dirMultiplier = direction === 'asc' ? 1 : -1;
    const getValue = SORTABLE_COLUMNS[activeColumn];
    return [...contacts].sort((a, b) => {
      const av = getValue(a);
      const bv = getValue(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dirMultiplier;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * dirMultiplier;
    });
  }, [contacts, sort]);

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

  if (!ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <div className="app-main">
        <div className="crm-page-header">
          <h1>Contacts</h1>
          <button className="btn btn-primary" onClick={() => { setCreateForm(EMPTY_FORM); setCreateError(''); setCreateOpen(true); }}>
            <Plus size={18} strokeWidth={2} aria-hidden /> Add contact
          </button>
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
        </div>

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
              {!fetching && contacts.length === 0 && (
                <tr><td colSpan={6} className="crm-table__empty">No contacts yet.</td></tr>
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
    </Layout>
  );
}
