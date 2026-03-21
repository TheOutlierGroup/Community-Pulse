import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';

export default function Login() {
  const { user, setUserFromLogin, logout } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) navigate(user.role === 'admin' ? '/admin' : '/pulse');
  }, [user, navigate]);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/api/auth/login', { email, password });
      setUserFromLogin(data);
      navigate(data.user.role === 'admin' ? '/admin' : '/pulse');
    } catch {
      setError('Invalid email or password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout user={user} onLogout={logout}>
      <div className="card" style={{ maxWidth: 420, margin: '2rem auto' }}>
        <h1>Welcome back</h1>
        <p className="muted">Log in to continue your Pulse or open the admin view.</p>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="error">{error}</p>}
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Log in'}
            </button>
          </div>
        </form>
        <p className="muted" style={{ marginTop: '1.5rem' }}>
          Invited? Open your invite link, or{' '}
          <Link to="/invite">enter your token</Link>.
        </p>
      </div>
    </Layout>
  );
}
