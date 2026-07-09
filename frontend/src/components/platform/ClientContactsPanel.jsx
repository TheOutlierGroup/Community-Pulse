import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../shared/ToastProvider.jsx';

const EMPTY_FORM = { contact_firstname: '', contact_lastname: '', contact_email: '', contact_phone: '', contact_role: '' };

function ContactFields({ form, setForm, disabled }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
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
    if (!window.confirm(`Delete ${contact.contact_firstname} ${contact.contact_lastname || ''}`.trim() + '?')) return;
    try {
      await api.delete(`/api/platform/organizations/${orgId}/contacts/${contact.contact_id}`);
      showToast('Contact deleted.', { variant: 'success' });
      load();
    } catch {
      showToast('Failed to delete contact.', { variant: 'error' });
    }
  }

  return (
    <div className="card platform-client-dashboard__card platform-client-dashboard__card--wide">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h3 className="platform-client-dashboard__h2" style={{ margin: 0 }}>
          Contacts {contacts.length > 0 ? `(${contacts.length})` : ''}
        </h3>
        <button className="btn btn-ghost" style={{ fontSize: '0.82rem', padding: '0.3rem 0.7rem' }} onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : <><Plus size={13} /> Add contact</>}
        </button>
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
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{c.contact_firstname} {c.contact_lastname}</div>
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
    </div>
  );
}
