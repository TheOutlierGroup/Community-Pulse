import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { Building2, KeyRound, MailPlus, Pencil, Users } from 'lucide-react';

export default function PlatformClients() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const [orgs, setOrgs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [orgUsers, setOrgUsers] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

  async function createOrg(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInviteLink('');
    try {
      const body = { name: newOrgName.trim() };
      if (newOrgAdminEmail.trim()) body.adminEmail = newOrgAdminEmail.trim();
      const { data } = await api.post('/api/platform/organizations', body);
      setNewOrgName('');
      setNewOrgAdminEmail('');
      await loadOrgs();
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
      <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Building2 size={28} strokeWidth={1.75} aria-hidden />
        Clients
      </h1>
      <p className="muted" style={{ marginBottom: '1.5rem' }}>
        Create and manage client companies, invites, and users per company.
      </p>
      {error && <p className="error">{error}</p>}
      {inviteLink && (
        <p className="card" style={{ marginBottom: '1rem', wordBreak: 'break-all' }}>
          Invite link: <a href={inviteLink}>{inviteLink}</a>
        </p>
      )}

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Building2 size={22} strokeWidth={1.75} aria-hidden />
          New company
        </h2>
        <form onSubmit={createOrg} className="grid-2" style={{ alignItems: 'end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="cname">Company name</label>
            <input
              id="cname"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              required
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="aemail">First admin email (optional)</label>
            <input
              id="aemail"
              type="email"
              value={newOrgAdminEmail}
              onChange={(e) => setNewOrgAdminEmail(e.target.value)}
              placeholder="invite@client.com"
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Create company
            </button>
          </div>
        </form>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Users size={22} strokeWidth={1.75} aria-hidden />
            Companies
          </h2>
          {!orgs.length && <p className="muted">No client companies yet.</p>}
          <ul className="platform-list">
            {orgs.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className={`platform-list-item ${selectedId === o.id ? 'active' : ''}`}
                  onClick={() => setSelectedId(o.id)}
                >
                  {o.name}
                </button>
              </li>
            ))}
          </ul>
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
                  <button type="submit" className="btn btn-primary" disabled={busy}>
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
                <table className="admin-table">
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
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <input
                              type="password"
                              autoComplete="new-password"
                              placeholder="Min 8 chars"
                              value={pwByUser[u.id] || ''}
                              onChange={(e) =>
                                setPwByUser((prev) => ({ ...prev, [u.id]: e.target.value }))
                              }
                              style={{ maxWidth: 140, minHeight: 40 }}
                            />
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: '0.85rem', padding: '0.35rem 0.65rem' }}
                              disabled={busy}
                              onClick={() => setPassword(u.id)}
                            >
                              <KeyRound size={16} style={{ marginRight: 4 }} aria-hidden />
                              Set
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <p className="muted">Select a company to manage users and invites.</p>
          )}
        </div>
      </div>
    </Layout>
  );
}
