import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { KeyRound, Users } from 'lucide-react';

export default function PlatformUsers() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [staffInviteEmail, setStaffInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [pwByUser, setPwByUser] = useState({});

  const loadStaff = useCallback(async () => {
    const { data } = await api.get('/api/platform/staff');
    setStaff(data.users || []);
  }, []);

  useEffect(() => {
    if (!ok) return;
    (async () => {
      try {
        await loadStaff();
      } catch (e) {
        setError(e.response?.data?.error || 'Failed to load team.');
      }
    })();
  }, [ok, loadStaff]);

  async function sendStaffInvite(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInviteLink('');
    try {
      const { data } = await api.post('/api/platform/staff/invites', {
        email: staffInviteEmail.trim(),
      });
      setStaffInviteEmail('');
      setInviteLink(`${window.location.origin}${data.inviteUrl}`);
      await loadStaff();
    } catch (err) {
      setError(err.response?.data?.error || 'Invite failed.');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !ok) return null;

  return (
    <Layout user={user} onLogout={logout}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Users size={28} strokeWidth={1.75} aria-hidden />
        Users
      </h1>
      <p className="muted" style={{ marginBottom: '1.5rem' }}>
        Invite platform admins and reset credentials for Outlier staff.
      </p>
      {error && <p className="error">{error}</p>}
      {inviteLink && (
        <p className="card" style={{ marginBottom: '1rem', wordBreak: 'break-all' }}>
          Invite link: <a href={inviteLink}>{inviteLink}</a>
        </p>
      )}

      <div className="card" style={{ maxWidth: 720 }}>
        <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Users size={22} strokeWidth={1.75} aria-hidden />
          Platform admins
        </h2>
        <form onSubmit={sendStaffInvite} className="grid-2" style={{ alignItems: 'end', maxWidth: 480 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="semail">Invite admin email</label>
            <input
              id="semail"
              type="email"
              value={staffInviteEmail}
              onChange={(e) => setStaffInviteEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Invite
            </button>
          </div>
        </form>
        <table className="admin-table" style={{ marginTop: '1rem' }}>
          <thead>
            <tr>
              <th>Email</th>
              <th>New password</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    <input
                      type="password"
                      autoComplete="new-password"
                      placeholder="Min 8 chars"
                      value={pwByUser[`s-${u.id}`] || ''}
                      onChange={(e) =>
                        setPwByUser((prev) => ({ ...prev, [`s-${u.id}`]: e.target.value }))
                      }
                      style={{ maxWidth: 140, minHeight: 40 }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: '0.85rem', padding: '0.35rem 0.65rem' }}
                      disabled={busy}
                      onClick={() => {
                        const p = pwByUser[`s-${u.id}`];
                        if (!p || p.length < 8) {
                          setError('Password must be at least 8 characters.');
                          return;
                        }
                        setBusy(true);
                        setError('');
                        api
                          .patch(`/api/platform/users/${u.id}/password`, { password: p })
                          .then(() => {
                            setPwByUser((prev) => ({ ...prev, [`s-${u.id}`]: '' }));
                          })
                          .catch((err) => {
                            setError(err.response?.data?.error || 'Password update failed.');
                          })
                          .finally(() => setBusy(false));
                      }}
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
      </div>
    </Layout>
  );
}
