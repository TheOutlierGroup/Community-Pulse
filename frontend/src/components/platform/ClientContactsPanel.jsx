import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../shared/ToastProvider.jsx';
import ModalDialog from '../shared/ModalDialog.jsx';
import {
  RELATIONSHIP_STATUS_OPTIONS,
  normalizeRelationshipStatus,
  relationshipStatusLabel,
  relationshipStatusBadgeClass,
} from '../../pages/platformClientUtils.js';

const EMPTY_FORM = {
  contact_firstname: '', contact_lastname: '', contact_email: '', contact_phone: '', contact_role: '', relationship_status: 'new',
};

function ContactFields({ form, setForm, disabled }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0.6rem' }}>
      {[
        { key: 'contact_firstname', label: 'First name *', required: true },
        { key: 'contact_lastname', label: 'Last name' },
        { key: 'contact_email', label: 'Email', type: 'email' },
        { key: 'contact_phone', label: 'Phone', type: 'tel' },
        { key: 'contact_role', label: 'Role / title' },
      ].map(({ key, label, type = 'text', required }) => (
        <div className="field" key={key} style={{ marginBottom: 0 }}>
          <label style={{ fontSize: '0.8rem' }}>{label}</label>
          <input
            type={type}
            value={form[key]}
            onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
            required={required}
            disabled={disabled}
          />
        </div>
      ))}
      <div className="field" style={{ marginBottom: 0 }}>
        <label style={{ fontSize: '0.8rem' }}>Relationship status</label>
        <select
          value={form.relationship_status}
          onChange={(e) => setForm((p) => ({ ...p, relationship_status: e.target.value }))}
          disabled={disabled}
        >
          {RELATIONSHIP_STATUS_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
    </div>
  );
}

/**
 * Lightweight contacts CRUD for a Client organisation — no notes/threads
 * (unlike the richer Prospect contacts panel). Contacts created here land
 * in the same global `crm_contacts` table as Prospect contacts, so they
 * automatically appear on the platform-wide Contacts page.
 */
export default function ClientContactsPanel({ orgId }) {
  const { showToast } = useToast();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);

  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addBusy, setAddBusy] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editBusy, setEditBusy] = useState(false);

  const [deletedModalOpen, setDeletedModalOpen] = useState(false);
  const [deletedContacts, setDeletedContacts] = useState([]);
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [restoringId, setRestoringId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/api/platform/organizations/${orgId}/contacts`);
      setContacts(data.contacts || []);
    } catch {
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function addContact(e) {
    e.preventDefault();
    if (!addForm.contact_firstname.trim()) return;
    setAddBusy(true);
    try {
      await api.post(`/api/platform/organizations/${orgId}/contacts`, addForm);
      setAddForm(EMPTY_FORM);
      setAdding(false);
      showToast('Contact added.', { variant: 'success' });
      load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to add contact.', { variant: 'error' });
    } finally {
      setAddBusy(false);
    }
  }

  function startEdit(contact) {
    setEditingId(contact.contact_id);
    setEditForm({
      contact_firstname: contact.contact_firstname || '',
      contact_lastname: contact.contact_lastname || '',
      contact_email: contact.contact_email || '',
      contact_phone: contact.contact_phone || '',
      contact_role: contact.contact_role || '',
      relationship_status: normalizeRelationshipStatus(contact.relationship_status),
    });
  }

  async function saveEdit(e) {
    e.preventDefault();
    setEditBusy(true);
    try {
      await api.patch(`/api/platform/organizations/${orgId}/contacts/${editingId}`, editForm);
      setEditingId(null);
      showToast('Contact updated.', { variant: 'success' });
      load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to update contact.', { variant: 'error' });
    } finally {
      setEditBusy(false);
    }
  }

  async function deleteContact(contact) {
    const name = `${contact.contact_firstname} ${contact.contact_lastname || ''}`.trim();
    if (!window.confirm(`Delete ${name}? It can be restored from "Recently deleted" for 30 days.`)) return;
    try {
      await api.delete(`/api/platform/organizations/${orgId}/contacts/${contact.contact_id}`);
      showToast('Contact deleted.', { variant: 'success' });
      load();
    } catch {
      showToast('Failed to delete contact.', { variant: 'error' });
    }
  }

  const openDeletedModal = useCallback(async () => {
    setDeletedModalOpen(true);
    setDeletedLoading(true);
    try {
      const { data } = await api.get(`/api/platform/organizations/${orgId}/contacts/deleted`);
      setDeletedContacts(data.contacts || []);
    } catch {
      setDeletedContacts([]);
    } finally {
      setDeletedLoading(false);
    }
  }, [orgId]);

  async function restoreDeletedContact(contact) {
    setRestoringId(contact.contact_id);
    try {
      await api.post(`/api/platform/organizations/${orgId}/contacts/${contact.contact_id}/restore`);
      setDeletedContacts((prev) => prev.filter((c) => c.contact_id !== contact.contact_id));
      showToast('Contact restored.', { variant: 'success' });
      load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Could not restore contact.', { variant: 'error' });
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="card platform-client-dashboard__card platform-client-dashboard__card--wide">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h3 className="platform-client-dashboard__h2" style={{ margin: 0 }}>
          Contacts {contacts.length > 0 ? `(${contacts.length})` : ''}
        </h3>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button className="btn btn-ghost" style={{ fontSize: '0.82rem', padding: '0.3rem 0.7rem' }} onClick={openDeletedModal}>
            <RotateCcw size={13} strokeWidth={2} /> Recently deleted
          </button>
          <button className="btn btn-ghost" style={{ fontSize: '0.82rem', padding: '0.3rem 0.7rem' }} onClick={() => setAdding((v) => !v)}>
            {adding ? 'Cancel' : <><Plus size={13} /> Add contact</>}
          </button>
        </div>
      </div>

      {adding && (
        <form onSubmit={addContact} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '1rem', marginBottom: '1rem' }}>
          <ContactFields form={addForm} setForm={setAddForm} disabled={addBusy} />
          <button className="btn btn-primary" type="submit" disabled={addBusy} style={{ marginTop: '0.6rem' }}>
            {addBusy ? 'Adding…' : 'Add contact'}
          </button>
        </form>
      )}

      {loading && <p className="muted" style={{ fontSize: '0.875rem' }}>Loading…</p>}
      {!loading && contacts.length === 0 && !adding && <p className="muted" style={{ fontSize: '0.875rem' }}>No contacts yet.</p>}

      {contacts.map((c) => (
        <div key={c.contact_id} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: '0.6rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', background: 'var(--surface)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{c.contact_firstname} {c.contact_lastname}</span>
                <span className={`badge ${relationshipStatusBadgeClass(c.relationship_status)}`}>
                  {relationshipStatusLabel(c.relationship_status)}
                </span>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                {[c.contact_role, c.contact_email].filter(Boolean).join(' · ') || 'No details'}
              </div>
            </div>
            <button className="btn btn-ghost" style={{ padding: '0.3rem' }} onClick={() => (editingId === c.contact_id ? setEditingId(null) : startEdit(c))} aria-label="Edit contact">
              <Pencil size={13} strokeWidth={2} />
            </button>
            <button className="btn btn-ghost" style={{ padding: '0.3rem' }} onClick={() => deleteContact(c)} aria-label="Delete contact">
              <Trash2 size={13} strokeWidth={2} />
            </button>
          </div>
          {editingId === c.contact_id && (
            <form onSubmit={saveEdit} style={{ padding: '0.85rem 1rem', background: 'var(--surface2)', borderTop: '1px solid var(--border)' }}>
              <ContactFields form={editForm} setForm={setEditForm} disabled={editBusy} />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
                <button className="btn btn-primary" type="submit" disabled={editBusy} style={{ fontSize: '0.85rem' }}>Save</button>
                <button className="btn btn-ghost" type="button" onClick={() => setEditingId(null)} style={{ fontSize: '0.85rem' }}>
                  <X size={13} strokeWidth={2} /> Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      ))}

      <ModalDialog
        open={deletedModalOpen}
        title="Recently deleted"
        titleId="recently-deleted-contacts-title"
        onClose={() => setDeletedModalOpen(false)}
      >
        {deletedLoading ? (
          <p>Loading…</p>
        ) : deletedContacts.length === 0 ? (
          <p>No recently deleted contacts. Deleted contacts stay recoverable here for 30 days.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {deletedContacts.map((c) => (
              <li
                key={c.contact_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  padding: '0.6rem 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{c.contact_firstname} {c.contact_lastname}</div>
                  <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>
                    Deleted {c.deleted_at ? new Date(c.deleted_at).toLocaleDateString() : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={restoringId === c.contact_id}
                  onClick={() => restoreDeletedContact(c)}
                >
                  {restoringId === c.contact_id ? 'Restoring…' : 'Restore'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </ModalDialog>
    </div>
  );
}
