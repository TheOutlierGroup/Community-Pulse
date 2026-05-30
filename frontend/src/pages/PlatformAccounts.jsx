import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users2, Plus, ChevronRight, X, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { useDocumentTitle, DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import Layout from '../components/shared/Layout.jsx';
import '../styles/crm.css';

function ContactRow({ contact, onDelete }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.875rem', gap: '0.5rem' }}>
      <div>
        <div style={{ fontWeight: 600 }}>{contact.firstName} {contact.lastName}</div>
        {contact.email && <div style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>{contact.email}</div>}
        {contact.jobTitle && <div style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>{contact.jobTitle}</div>}
      </div>
      {contact.isPrimary && <span className="badge badge-active">Primary</span>}
      <button className="btn btn-ghost" style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem' }} onClick={() => onDelete(contact.id)} aria-label="Remove contact">
        <X size={14} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}

function AccountRow({ account, onSelect }) {
  return (
    <tr className="platform-users-table__row--clickable" onClick={() => onSelect(account)} tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(account)}>
      <td style={{ fontWeight: 600 }}>{account.name}</td>
      <td style={{ color: 'var(--muted)' }}>{account.industry || '—'}</td>
      <td style={{ color: 'var(--muted)' }}>{account.website || '—'}</td>
      <td><ChevronRight size={16} strokeWidth={2} color="var(--muted)" aria-hidden /></td>
    </tr>
  );
}

export default function PlatformAccounts() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const { showToast } = useToast();

  const [accounts, setAccounts] = useState([]);
  const [search, setSearch] = useState('');
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');

  // Create account modal
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', website: '', industry: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  // Selected account panel
  const [selected, setSelected] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactForm, setContactForm] = useState({ firstName: '', lastName: '', email: '', jobTitle: '', isPrimary: false });
  const [addingContact, setAddingContact] = useState(false);

  useDocumentTitle(!loading && ok ? `Accounts | ${DEFAULT_TAB}` : null);

  const loadAccounts = useCallback(async () => {
    setFetching(true);
    try {
      const { data } = await api.get('/api/platform/accounts', { params: { search: search || undefined, limit: 100 } });
      setAccounts(data.accounts || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load accounts.');
    } finally {
      setFetching(false);
    }
  }, [search]);

  useEffect(() => {
    if (!ok) return;
    loadAccounts();
  }, [ok, loadAccounts]);

  const loadAccount = useCallback(async (acc) => {
    setSelected(acc);
    setContactsLoading(true);
    try {
      const { data } = await api.get(`/api/platform/accounts/${acc.id}`);
      setContacts(data.contacts || []);
    } catch {
      setContacts([]);
    } finally {
      setContactsLoading(false);
    }
  }, []);

  async function createAccount(e) {
    e.preventDefault();
    if (!form.name.trim()) { setFormError('Name is required.'); return; }
    setBusy(true); setFormError('');
    try {
      await api.post('/api/platform/accounts', form);
      showToast('Account created.', 'success');
      setCreateOpen(false);
      setForm({ name: '', website: '', industry: '', notes: '' });
      loadAccounts();
    } catch (e) {
      setFormError(e.response?.data?.error || 'Failed to create account.');
    } finally {
      setBusy(false);
    }
  }

  async function addContact(e) {
    e.preventDefault();
    if (!contactForm.firstName.trim() || !contactForm.lastName.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/platform/accounts/${selected.id}/contacts`, contactForm);
      showToast('Contact added.', 'success');
      setContactForm({ firstName: '', lastName: '', email: '', jobTitle: '', isPrimary: false });
      setAddingContact(false);
      loadAccount(selected);
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to add contact.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteContact(contactId) {
    try {
      await api.delete(`/api/platform/accounts/${selected.id}/contacts/${contactId}`);
      showToast('Contact removed.', 'success');
      loadAccount(selected);
    } catch {
      showToast('Failed to remove contact.', 'error');
    }
  }

  if (!ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <div className="app-main">
        <div className="crm-page-header">
          <h1>Accounts</h1>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={18} strokeWidth={2} aria-hidden /> New Account
          </button>
        </div>

        <div className="crm-filter-bar">
          <input
            type="search" placeholder="Search accounts…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 220 }}
          />
        </div>

        {error && <p className="error">{error}</p>}

        <div className="table-wrap">
          <table className="platform-users-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Industry</th>
                <th>Website</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fetching && (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>Loading…</td></tr>
              )}
              {!fetching && accounts.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem' }}>
                  No accounts yet. Create one to get started.
                </td></tr>
              )}
              {accounts.map((a) => (
                <AccountRow key={a.id} account={a} onSelect={loadAccount} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Account detail panel (right overlay) */}
      {selected && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 40, display: 'flex' }}>
          <div style={{ flex: 1, background: 'rgba(0,0,0,0.35)' }} onClick={() => setSelected(null)} />
          <div style={{ width: 'min(440px, 100vw)', background: 'var(--surface)', boxShadow: '-4px 0 32px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{selected.name}</h2>
              <button className="btn btn-ghost" style={{ padding: '0.4rem' }} onClick={() => setSelected(null)} aria-label="Close">
                <X size={20} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div style={{ padding: '1.25rem 1.5rem', flex: 1 }}>
              {selected.industry && <p className="muted" style={{ marginBottom: '0.5rem' }}>{selected.industry}</p>}
              {selected.website && <p className="muted" style={{ marginBottom: '1.25rem' }}><a href={selected.website} target="_blank" rel="noreferrer">{selected.website}</a></p>}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}>Contacts</h3>
                <button className="btn btn-ghost" style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }} onClick={() => setAddingContact((v) => !v)}>
                  {addingContact ? <ChevronUp size={14} /> : <Plus size={14} />}
                  {addingContact ? 'Cancel' : 'Add'}
                </button>
              </div>

              {addingContact && (
                <form onSubmit={addContact} style={{ marginBottom: '1rem', background: 'var(--surface2)', borderRadius: 10, padding: '1rem' }}>
                  <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <div className="field">
                      <label>First name *</label>
                      <input value={contactForm.firstName} onChange={(e) => setContactForm((p) => ({ ...p, firstName: e.target.value }))} required />
                    </div>
                    <div className="field">
                      <label>Last name *</label>
                      <input value={contactForm.lastName} onChange={(e) => setContactForm((p) => ({ ...p, lastName: e.target.value }))} required />
                    </div>
                  </div>
                  <div className="field">
                    <label>Email</label>
                    <input type="email" value={contactForm.email} onChange={(e) => setContactForm((p) => ({ ...p, email: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>Job title</label>
                    <input value={contactForm.jobTitle} onChange={(e) => setContactForm((p) => ({ ...p, jobTitle: e.target.value }))} />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                    <input type="checkbox" checked={contactForm.isPrimary} onChange={(e) => setContactForm((p) => ({ ...p, isPrimary: e.target.checked }))} />
                    Primary contact
                  </label>
                  <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>Save contact</button>
                </form>
              )}

              {contactsLoading && <p className="muted">Loading contacts…</p>}
              {!contactsLoading && contacts.length === 0 && <p className="muted">No contacts yet.</p>}
              {contacts.map((c) => (
                <ContactRow key={c.id} contact={c} onDelete={deleteContact} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Create account modal */}
      {createOpen && (
        <div className="modal-backdrop" onClick={() => setCreateOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-labelledby="create-account-title">
            <div className="modal-dialog__head">
              <h2 id="create-account-title">New Account</h2>
              <button className="modal-dialog__close" onClick={() => setCreateOpen(false)} aria-label="Close" />
            </div>
            <form onSubmit={createAccount}>
              <div className="field">
                <label htmlFor="acc-name">Company name *</label>
                <input id="acc-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required autoFocus />
              </div>
              <div className="field">
                <label htmlFor="acc-industry">Industry</label>
                <input id="acc-industry" value={form.industry} onChange={(e) => setForm((p) => ({ ...p, industry: e.target.value }))} />
              </div>
              <div className="field">
                <label htmlFor="acc-website">Website</label>
                <input id="acc-website" type="url" value={form.website} onChange={(e) => setForm((p) => ({ ...p, website: e.target.value }))} />
              </div>
              {formError && <p className="error">{formError}</p>}
              <div className="modal-dialog__actions">
                <button className="btn btn-ghost" type="button" onClick={() => setCreateOpen(false)}>Cancel</button>
                <button className="btn btn-primary" type="submit" disabled={busy}>Create account</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
