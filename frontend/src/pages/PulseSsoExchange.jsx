import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import Layout from '../components/shared/Layout.jsx';
import { useAuth } from '../components/shared/Auth.jsx';
import { crmLoginUrl } from '../config/appSurface.js';
import { getPostLoginPath } from '../utils/postLogin.js';

export default function PulseSsoExchange() {
  const { setUserFromLogin, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const handoffToken = params.get('handoff') || '';
  const queryOrgId = params.get('orgId') || '';

  useEffect(() => {
    let cancelled = false;

    async function runExchange() {
      if (!handoffToken) {
        setError('Missing handoff token.');
        return;
      }
      try {
        const { data } = await api.post('/api/auth/pulse-handoff/exchange', {
          token: handoffToken,
        });
        if (cancelled) return;
        setUserFromLogin(data);

        const targetOrgId = data.targetOrganizationId || queryOrgId;
        if (data.user?.organizationKind === 'platform' && targetOrgId) {
          navigate(`/platform/clients/${targetOrgId}/pulse`, { replace: true });
          return;
        }
        navigate(getPostLoginPath(data.user), { replace: true });
      } catch (e) {
        if (cancelled) return;
        setError(e?.response?.data?.error || 'Could not complete secure sign in.');
      }
    }

    runExchange();
    return () => {
      cancelled = true;
    };
  }, [handoffToken, queryOrgId, navigate, setUserFromLogin]);

  return (
    <Layout user={null} onLogout={logout} hideHeader>
      <div className="card login-card" style={{ maxWidth: 540 }}>
        <h1>Signing you in…</h1>
        {!error ? (
          <p className="muted">Please wait while we complete secure handoff.</p>
        ) : (
          <>
            <p className="error">{error}</p>
            <div className="btn-row">
              <a className="btn btn-primary" href={crmLoginUrl()}>
                Go to CRM login
              </a>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
