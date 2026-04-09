import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/shared/Layout.jsx';
import { useAuth } from '../components/shared/Auth.jsx';
import { crmLoginUrl } from '../config/appSurface.js';
import { getPostLoginPath } from '../utils/postLogin.js';

export default function PulseLanding() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate(getPostLoginPath(user), { replace: true });
    }
  }, [loading, user, navigate]);

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
      <div className="card login-card" style={{ maxWidth: 540 }}>
        <h1>Pulse</h1>
        <p className="muted">
          Pulse data is protected. Please sign in via the CRM to continue.
        </p>
        <div className="btn-row">
          <a className="btn btn-primary" href={crmLoginUrl()}>
            Log in to CRM
          </a>
        </div>
      </div>
    </Layout>
  );
}
