import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import api from '../services/api.js';
import { useToast } from '../components/shared/ToastProvider.jsx';
import PlatformClientHeader from './PlatformClientHeader.jsx';
import { KeyRound, MailPlus, Users } from 'lucide-react';

export default function PlatformClientUsers() {
  const { org, orgId, clientLogoUrl } = useOutletContext();
  const { showToast } = useToast();
  const [orgUsers, setOrgUsers] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('employee');
  const [pwByUser, setPwByUser] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadUsers = useCallback(async () => {
    const { data } = await api.get(`/api/platform/organizations/${orgId}/users`);
    setOrgUsers(data.users || []);
  }, [orgId]);

  useEffect(() => {
    loadUsers().catch(() => setOrgUsers([]));
  }, [loadUsers]);

  async function sendOrgInvite(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const invitedTo = inviteEmail.trim();
      const { data } = await api.post(`/api/platform/organizations/${orgId}/invites`, {
        email: invitedTo,
        invitedRole: inviteRole,
      });
      const fullInvite = `${window.location.origin}${data.inviteUrl}`;
      setInviteEmail('');
      showToast(`Invite link for ${invitedTo}:\n\n${fullInvite}`, {
        variant: 'success',
        durationMs: 20000,
      });
      await loadUsers();
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
      showToast('Password updated.', { variant: 'success' });
    } catch (err) {
      setError(err.response?.data?.error || 'Password update failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PlatformClientHeader orgName={org.name} logoSrc={clientLogoUrl} />
      {error && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}
      <div className="platform-client-dashboard-grid">
        <div className="card platform-client-dashboard__card platform-client-dashboard__card--wide">
          <h2 className="platform-client-dashboard__h2" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <MailPlus size={22} strokeWidth={1.75} aria-hidden />
            Invite user
          </h2>
          <form onSubmit={sendOrgInvite} className="grid-2" style={{ alignItems: 'end' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="dash-iemail">Email</label>
              <input
                id="dash-iemail"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="dash-irole">Role</label>
              <select
                id="dash-irole"
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
        </div>

        <div className="card platform-client-dashboard__card platform-client-dashboard__card--wide">
          <h2 className="platform-client-dashboard__h2" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Users size={22} strokeWidth={1.75} aria-hidden />
            Users
          </h2>
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
        </div>
      </div>
    </>
  );
}
