import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import Layout from '../components/shared/Layout.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { Building2, ChevronRight, Plus, X } from 'lucide-react';

export default function PlatformClients() {
  const { user, logout, loading } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const [orgs, setOrgs] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgAdminEmail, setNewOrgAdminEmail] = useState('');

  const loadOrgs = useCallback(async () => {
    const { data } = await api.get('/api/platform/organizations');
    setOrgs(data.organizations || []);
  }, []);

  useEffect(() => {
    if (!ok) return;
    (async () => {
      try {
        setError('');
        await loadOrgs();
      } catch (e) {
        setError(e.response?.data?.error || 'Failed to load companies.');
      }
    })();
  }, [ok, loadOrgs]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setModalOpen(false);
        setError('');
        setNewOrgName('');
        setNewOrgAdminEmail('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  function closeCreateModal() {
    setModalOpen(false);
    setError('');
    setNewOrgName('');
    setNewOrgAdminEmail('');
  }

  function openClient(orgId) {
    navigate(`/platform/clients/${orgId}`);
  }

  async function createOrg(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { name: newOrgName.trim() };
      if (newOrgAdminEmail.trim()) body.adminEmail = newOrgAdminEmail.trim();
      const { data } = await api.post('/api/platform/organizations', body);
      await loadOrgs();
      const companyName = newOrgName.trim();
      const fullInvite = data.inviteUrl
        ? `${window.location.origin}${data.inviteUrl}`
        : '';
      showToast(
        fullInvite
          ? `${companyName} was created.\n\nInvite link:\n${fullInvite}`
          : `${companyName} was added as a client company.`,
        { variant: 'success', durationMs: fullInvite ? 20000 : undefined }
      );
      closeCreateModal();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create organization.');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <div className="page-header-row">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <Building2 size={28} strokeWidth={1.75} aria-hidden />
            Clients
          </h1>
        </div>
        <button
          type="button"
          className="btn btn-primary platform-header-cta"
          onClick={() => {
            setError('');
            setModalOpen(true);
          }}
        >
          <Plus size={20} strokeWidth={2} aria-hidden />
          Create company
        </button>
      </div>

      {error && !modalOpen && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}

      <div className="card platform-users-card" style={{ marginBottom: '1.5rem' }}>
        <div className="table-wrap">
          <table className="admin-table platform-clients-table">
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col">Created</th>
                <th className="platform-clients-table__actions" scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {orgs.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted" style={{ padding: '1.5rem' }}>
                    No client companies yet. Create one to get started.
                  </td>
                </tr>
              )}
              {orgs.map((o) => (
                <tr key={o.id} className="platform-clients-table__row">
                  <td>
                    <button
                      type="button"
                      className="platform-clients-table__name-btn"
                      onClick={() => openClient(o.id)}
                    >
                      <span className="platform-users-table__name">{o.name}</span>
                    </button>
                  </td>
                  <td className="muted" style={{ fontSize: '0.9rem' }}>
                    {o.created_at
                      ? new Date(o.created_at).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })
                      : '—'}
                  </td>
                  <td className="platform-clients-table__actions">
                    <button
                      type="button"
                      className="btn btn-ghost platform-clients-table__manage"
                      onClick={() => openClient(o.id)}
                    >
                      Manage
                      <ChevronRight size={18} aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <div className="modal-backdrop" role="presentation" onClick={closeCreateModal}>
          <div
            className="modal-dialog card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-company-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-dialog__head">
              <h2 id="create-company-title" style={{ margin: 0, fontSize: '1.15rem' }}>
                Create company
              </h2>
              <button
                type="button"
                className="btn btn-ghost modal-dialog__close"
                onClick={closeCreateModal}
                aria-label="Close"
              >
                <X size={22} aria-hidden />
              </button>
            </div>
            <p className="muted" style={{ marginTop: '0.35rem', marginBottom: '1rem' }}>
              Add a client organization. Optionally invite a first admin by email.
            </p>
            {error && modalOpen && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}
            <form onSubmit={createOrg}>
              <div className="field">
                <label htmlFor="cname">Company name</label>
                <input
                  id="cname"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  required
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label htmlFor="aemail">First admin email (optional)</label>
                <input
                  id="aemail"
                  type="email"
                  value={newOrgAdminEmail}
                  onChange={(e) => setNewOrgAdminEmail(e.target.value)}
                  placeholder="invite@client.com"
                  autoComplete="off"
                />
              </div>
              <div className="modal-dialog__actions">
                <button type="button" className="btn btn-ghost" onClick={closeCreateModal} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary modal-dialog__submit" disabled={busy}>
                  {busy ? 'Creating…' : 'Create company'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
