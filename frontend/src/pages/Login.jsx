import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import { getPostLoginPath } from '../utils/postLogin.js';
import outlierLogo from '../images/outlier-logo.png';

export default function Login() {
  const { user, setUserFromLogin, logout, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate(getPostLoginPath(user), { replace: true });
  }, [user, loading, navigate]);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/api/auth/login', { email, password });
      setUserFromLogin(data);
      navigate(getPostLoginPath(data.user), { replace: true });
    } catch {
      setError('Invalid email or password.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Layout user={null} onLogout={logout} hideHeader>
        <p className="muted">Loading…</p>
      </Layout>
    );
  }

  if (user) return null;

  return (
    <Layout user={null} onLogout={logout} hideHeader>
      <div className="login-hero">
        <img src={outlierLogo} alt="Outlier" className="login-logo" width={160} height={48} />
      </div>
      <div className="card login-card">
        <h1>Sign in</h1>
        <p className="muted">Use your Outlier or client account.</p>
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
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>
        <p className="muted" style={{ marginTop: '1.5rem', fontSize: '0.9rem' }}>
          Have an invite link?{' '}
          <Link to="/invite">Accept invite</Link>
        </p>
      </div>
    </Layout>
  );
}
