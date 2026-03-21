import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';

export default function InviteAccept() {
  const { token: routeToken } = useParams();
  const { user, setUserFromLogin, logout } = useAuth();
  const navigate = useNavigate();
  const [token, setToken] = useState(routeToken || '');
  const [password, setPassword] = useState('');
  const [emailPreview, setEmailPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function validateToken(t) {
    if (!t) return;
    try {
      const { data } = await api.get(`/api/auth/invite/${t}`);
      setEmailPreview(data.email);
      setError('');
    } catch {
      setEmailPreview('');
      setError('Invalid or expired invite.');
    }
  }

  useEffect(() => {
    if (routeToken) {
      setToken(routeToken);
      validateToken(routeToken);
    }
  }, [routeToken]);

  useEffect(() => {
    if (user) navigate('/pulse');
  }, [user, navigate]);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/api/auth/accept-invite', {
        token: token.trim(),
        password,
      });
      setUserFromLogin(data);
      navigate('/pulse');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not accept invite.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout user={user} onLogout={logout}>
      <div className="card" style={{ maxWidth: 440, margin: '2rem auto' }}>
        <h1>Join Pulse</h1>
        <p className="muted">Set a password to activate your employee account.</p>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="token">Invite token</label>
            <input
              id="token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onBlur={() => validateToken(token.trim())}
              required
              placeholder="Paste token or use invite link"
            />
          </div>
          {emailPreview && (
            <p className="muted">
              Creating account for <strong>{emailPreview}</strong>
            </p>
          )}
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input
              id="pw"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          {error && <p className="error">{error}</p>}
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Create account'}
            </button>
          </div>
        </form>
        <p className="muted" style={{ marginTop: '1.25rem' }}>
          <Link to="/login">Back to login</Link>
        </p>
      </div>
    </Layout>
  );
}
