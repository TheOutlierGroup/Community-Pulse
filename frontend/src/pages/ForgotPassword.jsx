import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import outlierLogo from '../images/outlier-logo.png';

export default function ForgotPassword() {
  const { logout } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/auth/forgot-password', { email });
      setSent(true);
    } catch {
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout user={null} onLogout={logout} hideHeader>
      <div className="login-hero">
        <img src={outlierLogo} alt="Outlier" className="login-logo" width={160} height={48} />
      </div>
      <div className="card login-card">
        {sent ? (
          <>
            <h1>Check your email</h1>
            <p style={{ lineHeight: 1.6 }}>
              If an account exists for <strong>{email}</strong>, we sent a password reset link.
              It expires in 1 hour.
            </p>
            <p className="muted" style={{ marginTop: '1.5rem', fontSize: '0.9rem' }}>
              <Link to="/login">Back to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <h1>Reset password</h1>
            <p className="muted" style={{ marginBottom: '1rem' }}>
              Enter your email and we'll send you a link to reset your password.
            </p>
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
              <div className="btn-row">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Sending…' : 'Send reset link'}
                </button>
              </div>
            </form>
            <p className="muted" style={{ marginTop: '1.5rem', fontSize: '0.9rem' }}>
              Remember your password?{' '}
              <Link to="/login">Sign in</Link>
            </p>
          </>
        )}
      </div>
    </Layout>
  );
}
