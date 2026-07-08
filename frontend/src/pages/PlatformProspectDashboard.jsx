import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, X, ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import api from '../services/api.js';
import { useToast } from '../components/shared/ToastProvider.jsx';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function NoteItem({ note, onDelete }) {
  return (
    <div style={{ display: 'flex', gap: '0.6rem', padding: '0.65rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.875rem' }}>
      <div style={{ flex: 1 }}>
        <p style={{ margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{note.note_text}</p>
        <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.3rem' }}>
          {fmtDateTime(note.created_at)}{note.author_name?.trim() ? ` · ${note.author_name.trim()}` : ''}
        </div>
      </div>
      <button className="btn btn-ghost" style={{ padding: '0.25rem', alignSelf: 'flex-start', flexShrink: 0 }} onClick={() => onDelete(note.note_id)} aria-label="Delete note">
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  );
}

function AddNoteForm({ onAdd, busy }) {
  const [text, setText] = useState('');
  function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    onAdd(text);
    setText('');
  }
  return (
    <form onSubmit={submit} style={{ marginBottom: '0.75rem' }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a note…"
        rows={3}
        style={{ width: '100%', resize: 'vertical', font: 'inherit', fontSize: '0.875rem', padding: '0.55rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', boxSizing: 'border-box' }}
      />
      <button className="btn btn-primary" type="submit" disabled={busy || !text.trim()} style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}>
        Save note
      </button>
    </form>
  );
}

function ContactRow({ contact, orgId, onUpdated, onDeleted }) {
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    contact_firstname: contact.contact_firstname,
    contact_lastname: contact.contact_lastname || '',
    contact_email: contact.contact_email || '',
    contact_phone: contact.contact_phone || '',
    contact_role: contact.contact_role || '',
  });
  const [notes, setNotes] = useState(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  async function loadNotes() {
    if (notes !== null) return;
    try {
      const { data } = await api.get(`/api/platform/crm/organisations/${orgId}/contacts/${contact.contact_id}/notes`);
      setNotes(data.notes || []);
    } catch { setNotes([]); }
  }

  async function toggleExpand() {
    if (!expanded) await loadNotes();
    setExpanded((v) => !v);
  }

  async function saveContact(e) {
    e.preventDefault();
    setSaveBusy(true);
    try {
      const { data } = await api.patch(`/api/platform/crm/organisations/${orgId}/contacts/${contact.contact_id}`, form);
      showToast('Contact updated.', { variant: 'success' });
      setEditing(false);
      onUpdated(data.contact);
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to update contact.', { variant: 'error' });
    } finally { setSaveBusy(false); }
  }

  async function deleteContact() {
    if (!confirm('Delete this contact?')) return;
    try {
      await api.delete(`/api/platform/crm/organisations/${orgId}/contacts/${contact.contact_id}`);
      showToast('Contact deleted.', { variant: 'success' });
      onDeleted(contact.contact_id);
    } catch { showToast('Failed to delete contact.', { variant: 'error' }); }
  }

  async function addNote(text) {
    setNoteBusy(true);
    try {
      const { data } = await api.post(`/api/platform/crm/organisations/${orgId}/contacts/${contact.contact_id}/notes`, { note_text: text });
      setNotes((p) => [data.note, ...(p || [])]);
      showToast('Note added.', { variant: 'success' });
    } catch { showToast('Failed to add note.', { variant: 'error' }); }
    finally { setNoteBusy(false); }
  }

  async function deleteNote(noteId) {
    try {
      await api.delete(`/api/platform/crm/organisations/${orgId}/contacts/${contact.contact_id}/notes/${noteId}`);
      setNotes((p) => p.filter((n) => n.note_id !== noteId));
      showToast('Note deleted.', { variant: 'success' });
    } catch { showToast('Failed to delete note.', { variant: 'error' }); }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: '0.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', cursor: 'pointer', background: 'var(--surface)' }} onClick={toggleExpand}>
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
            {contact.contact_firstname} {contact.contact_lastname}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
            {[contact.contact_role, contact.contact_email].filter(Boolean).join(' · ') || 'No details'}
          </div>
        </div>
        <button className="btn btn-ghost" style={{ padding: '0.3rem' }} onClick={(e) => { e.stopPropagation(); setEditing((v) => !v); }} aria-label="Edit contact">
          <Pencil size={13} strokeWidth={2} />
        </button>
        <button className="btn btn-ghost" style={{ padding: '0.3rem' }} onClick={(e) => { e.stopPropagation(); deleteContact(); }} aria-label="Delete contact">
          <X size={13} strokeWidth={2} />
        </button>
      </div>

      {editing && (
        <form onSubmit={saveContact} style={{ padding: '0.85rem 1rem', background: 'var(--surface2)', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
            {[
              { key: 'contact_firstname', label: 'First name *', required: true },
              { key: 'contact_lastname', label: 'Last name' },
              { key: 'contact_email', label: 'Email', type: 'email' },
              { key: 'contact_phone', label: 'Phone', type: 'tel' },
            ].map(({ key, label, type = 'text', required }) => (
              <div className="field" key={key} style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '0.8rem' }}>{label}</label>
                <input type={type} value={form[key]} onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))} required={required} />
              </div>
            ))}
          </div>
          <div className="field" style={{ marginTop: '0.6rem', marginBottom: '0.6rem' }}>
            <label style={{ fontSize: '0.8rem' }}>Role / title</label>
            <input value={form.contact_role} onChange={(e) => setForm((p) => ({ ...p, contact_role: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-primary" type="submit" disabled={saveBusy} style={{ fontSize: '0.85rem' }}>Save</button>
            <button className="btn btn-ghost" type="button" onClick={() => setEditing(false)} style={{ fontSize: '0.85rem' }}>Cancel</button>
          </div>
        </form>
      )}

      {expanded && (
        <div style={{ padding: '0.85rem 1rem', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: '0.6rem' }}>Contact notes</div>
          <AddNoteForm onAdd={addNote} busy={noteBusy} />
          {notes === null && <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>Loading…</p>}
          {notes?.length === 0 && <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>No notes yet.</p>}
          {notes?.map((n) => <NoteItem key={n.note_id} note={n} onDelete={deleteNote} />)}
        </div>
      )}
    </div>
  );
}

export default function PlatformProspectDashboard() {
  const { org, orgId, contacts, setContacts, notes, setNotes } = useOutletContext();
  const { showToast } = useToast();

  const [addingContact, setAddingContact] = useState(false);
  const [contactForm, setContactForm] = useState({ contact_firstname: '', contact_lastname: '', contact_email: '', contact_phone: '', contact_role: '' });
  const [contactBusy, setContactBusy] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);

  async function addContact(e) {
    e.preventDefault();
    if (!contactForm.contact_firstname.trim()) return;
    setContactBusy(true);
    try {
      const { data } = await api.post(`/api/platform/crm/organisations/${orgId}/contacts`, contactForm);
      setContacts((p) => [...p, data.contact]);
      setContactForm({ contact_firstname: '', contact_lastname: '', contact_email: '', contact_phone: '', contact_role: '' });
      setAddingContact(false);
      showToast('Contact added.', { variant: 'success' });
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to add contact.', { variant: 'error' });
    } finally { setContactBusy(false); }
  }

  async function addOrgNote(text) {
    setNoteBusy(true);
    try {
      const { data } = await api.post(`/api/platform/crm/organisations/${orgId}/notes`, { note_text: text });
      setNotes((p) => [data.note, ...p]);
      showToast('Note added.', { variant: 'success' });
    } catch { showToast('Failed to add note.', { variant: 'error' }); }
    finally { setNoteBusy(false); }
  }

  async function deleteOrgNote(noteId) {
    try {
      await api.delete(`/api/platform/crm/organisations/${orgId}/notes/${noteId}`);
      setNotes((p) => p.filter((n) => n.note_id !== noteId));
      showToast('Note deleted.', { variant: 'success' });
    } catch { showToast('Failed to delete note.', { variant: 'error' }); }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '1.5rem', alignItems: 'start' }}>
      {/* Left: details + contacts */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* Details card */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: '1rem' }}>Details</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem 1.5rem', fontSize: '0.875rem' }}>
            {[
              { label: 'Industry', value: org.industry },
              { label: 'Website', value: org.website, link: true },
              { label: 'Phone', value: org.phone },
              { label: 'Lead source', value: org.lead_source },
              { label: 'Created', value: fmtDate(org.created_date) },
              { label: 'Expected close', value: fmtDate(org.expected_close_date) },
            ].map(({ label, value, link }) => (
              <div key={label}>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600, marginBottom: '0.15rem' }}>{label}</div>
                <div>
                  {link && value
                    ? <a href={value} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>{value}</a>
                    : value || <span style={{ color: 'var(--muted)' }}>—</span>
                  }
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Contacts */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
              Contacts ({contacts.length})
            </div>
            <button className="btn btn-ghost" style={{ fontSize: '0.82rem', padding: '0.3rem 0.7rem' }} onClick={() => setAddingContact((v) => !v)}>
              {addingContact ? 'Cancel' : <><Plus size={13} /> Add contact</>}
            </button>
          </div>

          {addingContact && (
            <form onSubmit={addContact} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                {[
                  { key: 'contact_firstname', label: 'First name *', required: true },
                  { key: 'contact_lastname', label: 'Last name' },
                  { key: 'contact_email', label: 'Email', type: 'email' },
                  { key: 'contact_phone', label: 'Phone', type: 'tel' },
                ].map(({ key, label, type = 'text', required }) => (
                  <div className="field" key={key} style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.8rem' }}>{label}</label>
                    <input type={type} value={contactForm[key]} onChange={(e) => setContactForm((p) => ({ ...p, [key]: e.target.value }))} required={required} />
                  </div>
                ))}
              </div>
              <div className="field" style={{ marginTop: '0.6rem' }}>
                <label style={{ fontSize: '0.8rem' }}>Role / title</label>
                <input value={contactForm.contact_role} onChange={(e) => setContactForm((p) => ({ ...p, contact_role: e.target.value }))} />
              </div>
              <button className="btn btn-primary" type="submit" disabled={contactBusy} style={{ marginTop: '0.5rem', width: '100%' }}>Add contact</button>
            </form>
          )}

          {contacts.length === 0 && !addingContact && <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>No contacts yet.</p>}
          {contacts.map((c) => (
            <ContactRow
              key={c.contact_id}
              contact={c}
              orgId={orgId}
              onUpdated={(updated) => setContacts((p) => p.map((x) => x.contact_id === updated.contact_id ? updated : x))}
              onDeleted={(cid) => setContacts((p) => p.filter((x) => x.contact_id !== cid))}
            />
          ))}
        </div>
      </div>

      {/* Right: org notes */}
      <div className="card" style={{ padding: '1.25rem' }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: '1rem' }}>
          Organisation Notes
        </div>
        <AddNoteForm onAdd={addOrgNote} busy={noteBusy} />
        {notes.length === 0 && <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>No notes yet.</p>}
        {notes.map((n) => <NoteItem key={n.note_id} note={n} onDelete={deleteOrgNote} />)}
      </div>
    </div>
  );
}
