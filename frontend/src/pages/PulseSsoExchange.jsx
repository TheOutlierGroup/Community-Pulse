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
  // BUG (6 Nov run-through): this effect used to cancel its own in-flight
  // exchange from its cleanup. setUserFromLogin and navigate change identity
  // when the auth provider finishes its own start-up check, which re-ran the
  // effect, flagged the first run cancelled, and then bailed out early on the
  // "already started" guard above. The exchange returned 200 but nothing ever
  // navigated, leaving the page stuck on "Signing you in…". The callbacks are
  // now read through refs, the effect depends only on the token, and only a
  // real unmount stops the redirect.
  const setUserFromLoginRef = useRef(setUserFromLogin);
  const navigateRef = useRef(navigate);
  setUserFromLoginRef.current = setUserFromLogin;
  navigateRef.current = navigate;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const handoffToken = params.get('handoff') || '';
  const queryOrgId = params.get('orgId') || '';
  const queryNext = params.get('next') || '';

  useEffect(() => {
    if (handoffToken && startedForTokenRef.current === handoffToken) return;
    startedForTokenRef.current = handoffToken;

    async function runExchange() {
      if (!handoffToken) {
        setError('Missing handoff token.');
        return;
      }
      try {
        const { data } = await api.post('/api/auth/rhythm-engine-handoff/exchange', {
          token: handoffToken,
        });
        if (!mountedRef.current) return;
        setUserFromLoginRef.current(data);

        const targetOrgId = data.targetOrganizationId || queryOrgId;
        // An Enterprise-tier client's own admin lands here the same way a
        // workspace (platform/licensee) staffer viewing a client does — via
        // this same handoff, with the same targetOrgId. Both need the
        // /rhythm-engine suffix: getPostLoginPath's bare
        // /platform/clients/:orgId has no matching route in this build's
        // narrower tree (see AppRhythmEngine.jsx) and would otherwise leave
        // them on a blank page.
        if ((isWorkspaceUser(data.user) || isEnterpriseClientSelfUser(data.user)) && targetOrgId) {
          const home = `/platform/clients/${targetOrgId}/rhythm-engine`;
          // Honour a deep link (e.g. Configurations) only when it stays
          // inside this client's Rhythm Engine.
          const deepLink = queryNext.startsWith(home) && !queryNext.includes('//') ? queryNext : '';
          navigateRef.current(deepLink || home, { replace: true });
          return;
        }
        navigateRef.current(getPostLoginPath(data.user), { replace: true });
      } catch (e) {
        if (!mountedRef.current) return;
        setError(e?.response?.data?.error || 'Could not complete secure sign in.');
      }
    }

    runExchange();
  }, [handoffToken, queryOrgId, queryNext]);

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
