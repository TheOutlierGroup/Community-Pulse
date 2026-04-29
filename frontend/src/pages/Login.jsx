import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';
import Layout from '../components/shared/Layout.jsx';
import { getPostLoginPath } from '../utils/postLogin.js';
import { getLoginErrorMessage } from '../utils/loginErrors.js';
import outlierLogo from '../images/outlier-logo.png';

export default function Login() {
  const { user, setUserFromLogin, logout, loading } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const mfaCodeInputRef = useRef(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate(getPostLoginPath(user), { replace: true });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (mfaRequired) mfaCodeInputRef.current?.focus();
  }, [mfaRequired]);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = { email, password };
      if (mfaRequired || mfaCode.trim()) payload.mfaCode = mfaCode.trim();
      const { data } = await api.post('/api/auth/login', payload);
      setUserFromLogin(data);
      navigate(getPostLoginPath(data.user), { replace: true });
    } catch (err) {
      const status = err.response?.status;
      const serverMsg =
        typeof err.response?.data?.error === 'string' ? err.response.data.error : '';
      if (status === 401 && serverMsg === 'MFA code is required') {
        setMfaRequired(true);
        showToast('Enter your authenticator app code to finish signing in.', { variant: 'error' });
        return;
      }
      showToast(getLoginErrorMessage(err), { variant: 'error' });
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
          {mfaRequired ? (
            <div className="field">
              <label htmlFor="mfa-code">Authenticator code</label>
              <input
                ref={mfaCodeInputRef}
                id="mfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Enter 6-digit code"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                required
              />
            </div>
          ) : null}
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Signing in…' : mfaRequired ? 'Verify and sign in' : 'Sign in'}
            </button>
          </div>
        </form>
        <p className="muted" style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
          <Link to="/forgot-password">Forgot password?</Link>
        </p>
      </div>
    </Layout>
  );
}
