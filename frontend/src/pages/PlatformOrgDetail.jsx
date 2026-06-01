import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, X, ChevronDown, ChevronRight, Pencil, Check } from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import Layout from '../components/shared/Layout.jsx';
import { BUSINESS_UNITS, LEAD_STATUSES, LEAD_STATUS_BADGE } from '../config/crmConstants.js';
import '../styles/crm.css';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function NoteItem({ note, onDelete }) {
  return (
    <div style={{ display: 'flex', gap: '0.6rem', padding: '0.65rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.875rem' }}>
      <div style={{ flex: 1 }}>
        <p style={{ margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{note.note_text}</p>
        <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.3rem' }}>
          {fmtDate(note.created_at)}{note.author_name ? ` · ${note.author_name}` : ''}
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
      showToast('Contact updated.', 'success');
      setEditing(false);
      onUpdated(data.contact);
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to update contact.', 'error');
    } finally { setSaveBusy(false); }
  }

  async function deleteContact() {
    if (!confirm('Delete this contact?')) return;
    try {
      await api.delete(`/api/platform/crm/organisations/${orgId}/contacts/${contact.contact_id}`);
      showToast('Contact deleted.', 'success');
      onDeleted(contact.contact_id);
    } catch { showToast('Failed to delete contact.', 'error'); }
  }

  async function addNote(text) {
    setNoteBusy(true);
    try {
      const { data } = await api.post(`/api/platform/crm/organisations/${orgId}/contacts/${contact.contact_id}/notes`, { note_text: text });
      setNotes((p) => [data.note, ...(p || [])]);
      showToast('Note added.', 'success');
    } catch { showToast('Failed to add note.', 'error'); }
    finally { setNoteBusy(false); }
  }

  async function deleteNote(noteId) {
    try {
      await api.delete(`/api/platform/crm/organisations/${orgId}/contacts/${contact.contact_id}/notes/${noteId}`);
      setNotes((p) => p.filter((n) => n.note_id !== noteId));
      showToast('Note deleted.', 'success');
    } catch { showToast('Failed to delete note.', 'error'); }
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

export default function PlatformOrgDetail() {
  const { id } = useParams();
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const { showToast } = useToast();

  const [org, setOrg] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [orgNotes, setOrgNotes] = useState([]);
  const [fetching, setFetching] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saveBusy, setSaveBusy] = useState(false);

  const [addingContact, setAddingContact] = useState(false);
  const [contactForm, setContactForm] = useState({ contact_firstname: '', contact_lastname: '', contact_email: '', contact_phone: '', contact_role: '' });
  const [contactBusy, setContactBusy] = useState(false);

  const [noteBusy, setNoteBusy] = useState(false);

  useDocumentTitle(!loading && ok && org ? `${org.organisation_name} | ${DEFAULT_TAB}` : null);

  const load = useCallback(async () => {
    setFetching(true);
    try {
      const { data } = await api.get(`/api/platform/crm/organisations/${id}`);
      setOrg(data.organisation);
      setContacts(data.contacts || []);
      setOrgNotes(data.notes || []);
      setEditForm({
        organisation_name: data.organisation.organisation_name,
        industry: data.organisation.industry || '',
        website: data.organisation.website || '',
        phone: data.organisation.phone || '',
        business_unit: data.organisation.business_unit,
        lead_status: data.organisation.lead_status,
        lead_source: data.organisation.lead_source || '',
        expected_close_date: data.organisation.expected_close_date?.slice(0, 10) || '',
      });
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to load organisation.', 'error');
    } finally { setFetching(false); }
  }, [id, showToast]);

  useEffect(() => { if (ok) load(); }, [ok, load]);

  async function saveOrg(e) {
    e.preventDefault();
    setSaveBusy(true);
    try {
      const { data } = await api.patch(`/api/platform/crm/organisations/${id}`, editForm);
      setOrg(data.organisation);
      setEditing(false);
      showToast('Organisation updated.', 'success');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to update.', 'error');
    } finally { setSaveBusy(false); }
  }

  async function deleteOrg() {
    if (!confirm(`Delete "${org.organisation_name}"? This will also delete all contacts and notes.`)) return;
    try {
      await api.delete(`/api/platform/crm/organisations/${id}`);
      showToast('Organisation deleted.', 'success');
      navigate('/platform/crm/organisations');
    } catch { showToast('Failed to delete organisation.', 'error'); }
  }

  async function addContact(e) {
    e.preventDefault();
    if (!contactForm.contact_firstname.trim()) return;
    setContactBusy(true);
    try {
      const { data } = await api.post(`/api/platform/crm/organisations/${id}/contacts`, contactForm);
      setContacts((p) => [...p, data.contact]);
      setContactForm({ contact_firstname: '', contact_lastname: '', contact_email: '', contact_phone: '', contact_role: '' });
      setAddingContact(false);
      showToast('Contact added.', 'success');
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to add contact.', 'error');
    } finally { setContactBusy(false); }
  }

  async function addOrgNote(text) {
    setNoteBusy(true);
    try {
      const { data } = await api.post(`/api/platform/crm/organisations/${id}/notes`, { note_text: text });
      setOrgNotes((p) => [data.note, ...p]);
      showToast('Note added.', 'success');
    } catch { showToast('Failed to add note.', 'error'); }
    finally { setNoteBusy(false); }
  }

  async function deleteOrgNote(noteId) {
    try {
      await api.delete(`/api/platform/crm/organisations/${id}/notes/${noteId}`);
      setOrgNotes((p) => p.filter((n) => n.note_id !== noteId));
      showToast('Note deleted.', 'success');
    } catch { showToast('Failed to delete note.', 'error'); }
  }

  if (!ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <div className="app-main">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" style={{ padding: '0.4rem 0.7rem' }} onClick={() => navigate('/platform/crm/organisations')}>
            <ArrowLeft size={16} strokeWidth={2} aria-hidden />
          </button>
          {org && (
            <>
              <h1 style={{ margin: 0, flex: 1 }}>{org.organisation_name}</h1>
              <span className={LEAD_STATUS_BADGE[org.lead_status] || 'badge'}>{org.lead_status}</span>
              <span style={{ fontSize: '0.82rem', color: 'var(--muted)', background: 'var(--surface2)', padding: '0.25rem 0.65rem', borderRadius: 999, border: '1px solid var(--border)' }}>{org.business_unit}</span>
              <button className="btn btn-ghost" style={{ fontSize: '0.85rem' }} onClick={() => setEditing((v) => !v)}>
                {editing ? 'Cancel' : <><Pencil size={14} /> Edit</>}
              </button>
              <button className="btn btn-ghost" style={{ fontSize: '0.85rem', color: 'var(--danger)' }} onClick={deleteOrg}>Delete</button>
            </>
          )}
        </div>

        {fetching && <p className="muted">Loading…</p>}

        {org && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '1.5rem', alignItems: 'start' }}>

            {/* Left: details + contacts */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

              {/* Details card */}
              <div className="card" style={{ padding: '1.25rem' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: '1rem' }}>Details</div>

                {editing ? (
                  <form onSubmit={saveOrg}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      <div className="field">
                        <label>Organisation name *</label>
                        <input value={editForm.organisation_name} onChange={(e) => setEditForm((p) => ({ ...p, organisation_name: e.target.value }))} required />
                      </div>
                      <div className="field">
                        <label>Industry</label>
                        <input value={editForm.industry} onChange={(e) => setEditForm((p) => ({ ...p, industry: e.target.value }))} />
                      </div>
                      <div className="field">
                        <label>Business unit</label>
                        <select value={editForm.business_unit} onChange={(e) => setEditForm((p) => ({ ...p, business_unit: e.target.value }))}>
                          {BUSINESS_UNITS.map((b) => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>
                      <div className="field">
                        <label>Lead status</label>
                        <select value={editForm.lead_status} onChange={(e) => setEditForm((p) => ({ ...p, lead_status: e.target.value }))}>
                          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div className="field">
                        <label>Website</label>
                        <input type="url" value={editForm.website} onChange={(e) => setEditForm((p) => ({ ...p, website: e.target.value }))} />
                      </div>
                      <div className="field">
                        <label>Phone</label>
                        <input type="tel" value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} />
                      </div>
                      <div className="field">
                        <label>Lead source</label>
                        <input value={editForm.lead_source} onChange={(e) => setEditForm((p) => ({ ...p, lead_source: e.target.value }))} />
                      </div>
                      <div className="field">
                        <label>Expected close date</label>
                        <input type="date" value={editForm.expected_close_date} onChange={(e) => setEditForm((p) => ({ ...p, expected_close_date: e.target.value }))} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                      <button className="btn btn-primary" type="submit" disabled={saveBusy}>Save changes</button>
                      <button className="btn btn-ghost" type="button" onClick={() => setEditing(false)}>Cancel</button>
                    </div>
                  </form>
                ) : (
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
                )}
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
                    orgId={id}
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
              {orgNotes.length === 0 && <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>No notes yet.</p>}
              {orgNotes.map((n) => <NoteItem key={n.note_id} note={n} onDelete={deleteOrgNote} />)}
            </div>

          </div>
        )}
      </div>
    </Layout>
  );
}
