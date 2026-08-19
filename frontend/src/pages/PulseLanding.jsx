import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/shared/Layout.jsx';
import { useAuth } from '../components/shared/Auth.jsx';
import { crmLoginUrl, crmAppBaseUrl, IS_RHYTHM_ENGINE_SURFACE } from '../config/appSurface.js';
import { getPostLoginPath, isPostLoginPathServedByRhythmEngineSurface } from '../utils/postLogin.js';

export default function PulseLanding() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !user) return;
    const path = getPostLoginPath(user);
    // A workspace user or an Enterprise-tier client's own admin can resolve
    // to a CRM-only path (e.g. bare /platform/clients/:orgId) that this
    // build never routes — an in-app navigate would leave them on a blank
    // page. Cross back to the CRM origin instead.
    if (IS_RHYTHM_ENGINE_SURFACE && !isPostLoginPathServedByRhythmEngineSurface(path)) {
      const base = crmAppBaseUrl();
      if (base) {
        window.location.replace(`${base}${path}`);
        return;
      }
    }
    navigate(path, { replace: true });
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
        <h1>Rhythm Engine</h1>
        <p className="muted">
          Rhythm Engine data is protected. Please sign in via the CRM to continue.
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
