import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import { CLIENT_SERVICE_PULSE, getPostLoginPath, userHasService } from '../utils/postLogin.js';
import { Activity, LayoutDashboard } from 'lucide-react';

export default function ClientHome() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate('/');
    else if (user && user.organizationKind !== 'client') navigate(getPostLoginPath(user));
    else if (user && user.role !== 'admin') navigate(getPostLoginPath(user));
    // Enterprise-tier clients get their own self-service workspace at
    // /platform/clients/:orgId — this legacy Guided-tier dashboard (and
    // its "Open Rhythm Engine admin" link into the old /admin session
    // manager) is a second, disconnected surface for the same data.
    else if (user && user.clientPortalTier === 'enterprise') navigate(getPostLoginPath(user));
  }, [user, loading, navigate]);

  if (
    loading ||
    !user ||
    user.organizationKind !== 'client' ||
    user.role !== 'admin' ||
    user.clientPortalTier === 'enterprise'
  ) {
    return null;
  }

  return (
    <Layout user={user} onLogout={logout}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <LayoutDashboard size={28} strokeWidth={1.75} aria-hidden />
        Dashboard
      </h1>
      <p className="muted" style={{ marginBottom: '1.5rem' }}>
        {user.organizationName || 'Your organization'}
      </p>
      {userHasService(user, CLIENT_SERVICE_PULSE) ? (
        <div className="card" style={{ maxWidth: 480 }}>
          <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={22} strokeWidth={1.75} aria-hidden />
            Rhythm Engine
          </h2>
          <p className="muted">Run diagnostics, invite employees, and review session analytics.</p>
          <Link to="/admin" className="btn btn-primary" style={{ marginTop: '1rem', display: 'inline-flex' }}>
            Open Rhythm Engine admin
          </Link>
        </div>
      ) : (
        <div className="card" style={{ maxWidth: 480 }}>
          <h2 style={{ marginTop: 0 }}>No active services</h2>
          <p className="muted" style={{ marginBottom: 0 }}>
            Rhythm Engine is not enabled for this client.
          </p>
        </div>
      )}
    </Layout>
  );
}
