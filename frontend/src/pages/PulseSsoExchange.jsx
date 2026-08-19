import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import Layout from '../components/shared/Layout.jsx';
import { useAuth } from '../components/shared/Auth.jsx';
import { crmLoginUrl } from '../config/appSurface.js';
import { getPostLoginPath } from '../utils/postLogin.js';
import { isWorkspaceUser, isEnterpriseClientSelfUser } from '../hooks/usePlatformAccess.js';

export default function PulseSsoExchange() {
  const { setUserFromLogin, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  // A handoff token is single-use server-side. setUserFromLogin below
  // changes auth state (and fetchBrandSafely inside it changes more,
  // asynchronously, moments later); both are captured by this effect's own
  // dependency array, so a successful exchange can retrigger this same
  // effect while the route transition is still in flight and re-POST the
  // now-already-consumed token — the second attempt 401s with "Invalid or
  // expired handoff token" even though the first attempt succeeded. Track
  // which token this component instance has already started exchanging so
  // any re-invocation for the same token is a no-op.
  const startedForTokenRef = useRef('');

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const handoffToken = params.get('handoff') || '';
  const queryOrgId = params.get('orgId') || '';

  useEffect(() => {
    if (handoffToken && startedForTokenRef.current === handoffToken) return undefined;
    startedForTokenRef.current = handoffToken;
    let cancelled = false;

    async function runExchange() {
      if (!handoffToken) {
        setError('Missing handoff token.');
        return;
      }
      try {
        const { data } = await api.post('/api/auth/rhythm-engine-handoff/exchange', {
          token: handoffToken,
        });
        if (cancelled) return;
        setUserFromLogin(data);

        const targetOrgId = data.targetOrganizationId || queryOrgId;
        // An Enterprise-tier client's own admin lands here the same way a
        // workspace (platform/licensee) staffer viewing a client does — via
        // this same handoff, with the same targetOrgId. Both need the
        // /rhythm-engine suffix: getPostLoginPath's bare
        // /platform/clients/:orgId has no matching route in this build's
        // narrower tree (see AppRhythmEngine.jsx) and would otherwise leave
        // them on a blank page.
        if ((isWorkspaceUser(data.user) || isEnterpriseClientSelfUser(data.user)) && targetOrgId) {
          navigate(`/platform/clients/${targetOrgId}/rhythm-engine`, { replace: true });
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
