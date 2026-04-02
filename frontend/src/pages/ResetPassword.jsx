import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import Layout from '../components/shared/Layout.jsx';
import outlierLogo from '../images/outlier-logo.png';

export default function ResetPassword() {
  const { token } = useParams();
  const { logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (password.length < 8) {
      showToast('Password must be at least 8 characters', { variant: 'error' });
      return;
    }
    if (password !== confirm) {
      showToast('Passwords do not match', { variant: 'error' });
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      const msg = err.response?.data?.error || 'Reset failed — the link may have expired';
      showToast(msg, { variant: 'error' });
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
        {done ? (
          <>
            <h1>Password updated</h1>
            <p style={{ lineHeight: 1.6 }}>
              Your password has been reset. You can now sign in with your new password.
            </p>
            <div className="btn-row">
              <button
                className="btn btn-primary"
                onClick={() => navigate('/login')}
              >
                Sign in
              </button>
            </div>
          </>
        ) : (
          <>
            <h1>Set your password</h1>
            <form onSubmit={onSubmit}>
              <div className="field">
                <label htmlFor="password">New password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <div className="field">
                <label htmlFor="confirm">Confirm password</label>
                <input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <div className="btn-row">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Resetting…' : 'Reset password'}
                </button>
              </div>
            </form>
            <p className="muted" style={{ marginTop: '1.5rem', fontSize: '0.9rem' }}>
              <Link to="/login">Back to sign in</Link>
            </p>
          </>
        )}
      </div>
    </Layout>
  );
}
