import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import Dashboard from '../components/admin/Dashboard.jsx';
import { CLIENT_SERVICE_PULSE, userHasService } from '../utils/postLogin.js';

export default function AdminHome() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [overview, setOverview] = useState(null);
  const [name, setName] = useState('Q1 Rhythm Engine');
  const [sessionAudience, setSessionAudience] = useState('staff');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFirstName, setInviteFirstName] = useState('');
  const [inviteLastName, setInviteLastName] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [inviteEmailed, setInviteEmailed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get('/api/admin/overview');
      setOverview(data);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load admin data.');
    }
  };

  useEffect(() => {
    if (!loading && !user) navigate('/');
    else if (user?.organizationKind === 'platform') navigate('/platform');
    else if (user && user.role !== 'admin') {
      navigate(userHasService(user, CLIENT_SERVICE_PULSE) ? '/rhythm-engine' : '/account');
    }
    else if (user?.organizationKind !== 'client') navigate('/');
    else if (user && user.role === 'admin' && !userHasService(user, CLIENT_SERVICE_PULSE)) {
      navigate('/client');
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user?.role === 'admin') load();
  }, [user]);

  useEffect(() => {
    const id = location.hash?.replace(/^#/, '');
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash, overview]);

  async function createSession(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/admin/sessions', { name, status: 'draft', audience: sessionAudience });
      setName('Q1 Rhythm Engine');
      setSessionAudience('staff');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create session.');
    } finally {
      setBusy(false);
    }
  }

  async function setSessionStatus(id, status) {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/admin/sessions/${id}`, { status });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Update failed.');
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInviteLink('');
    setInviteEmailed(false);
    try {
      const { data } = await api.post('/api/admin/invites', {
        email: inviteEmail,
        firstName: inviteFirstName.trim() || undefined,
        lastName: inviteLastName.trim() || undefined,
      });
      const base = window.location.origin;
      setInviteLink(`${base}${data.inviteUrl}`);
      setInviteEmailed(Boolean(data.inviteEmailSent));
      setInviteEmail('');
      setInviteFirstName('');
      setInviteLastName('');
    } catch (err) {
      setError(err.response?.data?.error || 'Invite failed.');
    } finally {
      setBusy(false);
    }
  }

  if (
    loading ||
    !user ||
    user.role !== 'admin' ||
    user.organizationKind !== 'client' ||
    !userHasService(user, CLIENT_SERVICE_PULSE)
  ) {
    return null;
  }

  return (
    <Layout user={user} onLogout={logout}>
      <h1>Admin</h1>
      <p className="muted" style={{ marginBottom: '1.5rem' }}>
        Run diagnostics, invite employees, and open analytics per session.
      </p>
      {error && <p className="error">{error}</p>}

      <Dashboard overview={overview} />

      <div id="admin-sessions" className="card" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>New session</h2>
        <form onSubmit={createSession} className="grid-2" style={{ alignItems: 'end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="sname">Session name</label>
            <input
              id="sname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="saud">Survey audience</label>
            <select
              id="saud"
              value={sessionAudience}
              onChange={(e) => setSessionAudience(e.target.value)}
            >
              <option value="staff">Staff (employees)</option>
              <option value="manager">Managers</option>
            </select>
          </div>
          <div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Create draft
            </button>
          </div>
        </form>
      </div>

      <div id="admin-team" className="card" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>Invite employee</h2>
        <form onSubmit={sendInvite}>
          <div className="field">
            <label htmlFor="inv">Email</label>
            <input
              id="inv"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
            />
          </div>
          <div className="field" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 10rem', marginBottom: 0 }}>
              <label htmlFor="inv-first">First name (optional)</label>
              <input
                id="inv-first"
                value={inviteFirstName}
                onChange={(e) => setInviteFirstName(e.target.value)}
                autoComplete="given-name"
              />
            </div>
            <div className="field" style={{ flex: '1 1 10rem', marginBottom: 0 }}>
              <label htmlFor="inv-last">Last name (optional)</label>
              <input
                id="inv-last"
                value={inviteLastName}
                onChange={(e) => setInviteLastName(e.target.value)}
                autoComplete="family-name"
              />
            </div>
          </div>
          <div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Create invite link
            </button>
          </div>
        </form>
        {inviteLink && (
          <p style={{ marginTop: '1rem', wordBreak: 'break-all' }}>
            {inviteEmailed
              ? 'Invitation emailed. You can also share the link directly: '
              : 'Invitation could not be emailed — share this link instead: '}
            <a href={inviteLink}>{inviteLink}</a>
          </p>
        )}
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>Manage sessions</h2>
        {!overview?.sessions?.length && <p className="muted">No sessions yet.</p>}
        {overview?.sessions?.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Audience</th>
                <th>Status</th>
                <th>Actions</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {overview.sessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.audience === 'manager' ? 'Managers' : 'Staff'}</td>
                  <td>
                    <span className={`badge badge-${s.status}`}>{s.status}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                      {s.status === 'draft' && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
                          disabled={busy}
                          onClick={() => setSessionStatus(s.id, 'active')}
                        >
                          Activate
                        </button>
                      )}
                      {s.status === 'active' && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}
                          disabled={busy}
                          onClick={() => setSessionStatus(s.id, 'closed')}
                        >
                          Close
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    <Link to={`/admin/sessions/${s.id}`} className="btn btn-ghost" style={{ fontSize: '0.85rem' }}>
                      Analytics
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
