import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { Building2, ChevronRight, KeyRound, MailPlus, Pencil, Plus, Users, X } from 'lucide-react';

export default function PlatformClients() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const [orgs, setOrgs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [orgUsers, setOrgUsers] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgAdminEmail, setNewOrgAdminEmail] = useState('');

  const [editName, setEditName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('employee');
  const [inviteLink, setInviteLink] = useState('');
  const [pwByUser, setPwByUser] = useState({});

  const loadOrgs = useCallback(async () => {
    const { data } = await api.get('/api/platform/organizations');
    setOrgs(data.organizations || []);
  }, []);

  const loadOrgUsers = useCallback(async (orgId) => {
    if (!orgId) {
      setOrgUsers([]);
      return;
    }
    const { data } = await api.get(`/api/platform/organizations/${orgId}/users`);
    setOrgUsers(data.users || []);
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
    if (selectedId) loadOrgUsers(selectedId);
  }, [selectedId, loadOrgUsers]);

  useEffect(() => {
    const o = orgs.find((x) => x.id === selectedId);
    if (o) setEditName(o.name);
  }, [selectedId, orgs]);

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

  async function createOrg(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInviteLink('');
    try {
      const body = { name: newOrgName.trim() };
      if (newOrgAdminEmail.trim()) body.adminEmail = newOrgAdminEmail.trim();
      const { data } = await api.post('/api/platform/organizations', body);
      await loadOrgs();
      closeCreateModal();
      if (data.inviteUrl) {
        setInviteLink(`${window.location.origin}${data.inviteUrl}`);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create organization.');
    } finally {
      setBusy(false);
    }
  }

  async function saveOrg(e) {
    e.preventDefault();
    if (!selectedId) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/organizations/${selectedId}`, { name: editName.trim() });
      await loadOrgs();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update organization.');
    } finally {
      setBusy(false);
    }
  }

  async function sendOrgInvite(e) {
    e.preventDefault();
    if (!selectedId) return;
    setBusy(true);
    setError('');
    setInviteLink('');
    try {
      const { data } = await api.post(`/api/platform/organizations/${selectedId}/invites`, {
        email: inviteEmail.trim(),
        invitedRole: inviteRole,
      });
      setInviteEmail('');
      setInviteLink(`${window.location.origin}${data.inviteUrl}`);
      await loadOrgUsers(selectedId);
    } catch (err) {
      setError(err.response?.data?.error || 'Invite failed.');
    } finally {
      setBusy(false);
    }
  }

  async function setPassword(userId) {
    const password = pwByUser[userId];
    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/platform/users/${userId}/password`, { password });
      setPwByUser((prev) => ({ ...prev, [userId]: '' }));
    } catch (err) {
      setError(err.response?.data?.error || 'Password update failed.');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !ok) return null;

  const selected = orgs.find((o) => o.id === selectedId);

  return (
    <Layout user={user} onLogout={logout}>
      <div className="page-header-row">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
            <Building2 size={28} strokeWidth={1.75} aria-hidden />
            Clients
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            Client companies, invites, and users per company.
          </p>
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
      {inviteLink && (
        <p className="card" style={{ marginBottom: '1rem', wordBreak: 'break-all' }}>
          Invite link: <a href={inviteLink}>{inviteLink}</a>
        </p>
      )}

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
                <tr
                  key={o.id}
                  className={
                    selectedId === o.id ? 'platform-clients-table__row platform-clients-table__row--active' : 'platform-clients-table__row'
                  }
                >
                  <td>
                    <button
                      type="button"
                      className="platform-clients-table__name-btn"
                      onClick={() => setSelectedId(o.id)}
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
                      onClick={() => setSelectedId(o.id)}
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

      <div className="card">
        {selected ? (
          <>
            <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Pencil size={22} strokeWidth={1.75} aria-hidden />
              {selected.name}
            </h2>
            <form onSubmit={saveOrg} style={{ marginBottom: '1.25rem' }}>
              <div className="field">
                <label htmlFor="ename">Company name</label>
                <input id="ename" value={editName} onChange={(e) => setEditName(e.target.value)} required />
              </div>
              <button type="submit" className="btn btn-ghost" disabled={busy}>
                Save name
              </button>
            </form>

            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <MailPlus size={20} strokeWidth={1.75} aria-hidden />
              Invite user
            </h3>
            <form onSubmit={sendOrgInvite} className="grid-2" style={{ alignItems: 'end' }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="iemail">Email</label>
                <input
                  id="iemail"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="irole">Role</label>
                <select
                  id="irole"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  style={{ minHeight: 44, borderRadius: 10, padding: '0.5rem 0.75rem' }}
                >
                  <option value="employee">Employee</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <button type="submit" className="btn btn-primary platform-inline-primary" disabled={busy}>
                  Create invite
                </button>
              </div>
            </form>

            <h3 style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Users size={20} strokeWidth={1.75} aria-hidden />
              Users
            </h3>
            {!orgUsers.length && <p className="muted">No users yet.</p>}
            {orgUsers.length > 0 && (
              <div className="table-wrap">
                <table className="admin-table platform-clients-users-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Role</th>
                      <th>New password</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orgUsers.map((u) => (
                      <tr key={u.id}>
                        <td>{u.email}</td>
                        <td>
                          <span className={`badge badge-${u.role === 'admin' ? 'active' : 'draft'}`}>
                            {u.role}
                          </span>
                        </td>
                        <td>
                          <div className="platform-users-table__pw">
                            <input
                              type="password"
                              autoComplete="new-password"
                              placeholder="Min 8 chars"
                              value={pwByUser[u.id] || ''}
                              onChange={(e) =>
                                setPwByUser((prev) => ({ ...prev, [u.id]: e.target.value }))
                              }
                              aria-label={`New password for ${u.email}`}
                            />
                            <button
                              type="button"
                              className="btn btn-ghost platform-users-table__pw-btn"
                              disabled={busy}
                              onClick={() => setPassword(u.id)}
                            >
                              <KeyRound size={16} aria-hidden />
                              Set
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Select a company in the table above to edit details, send invites, and manage users.
          </p>
        )}
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
