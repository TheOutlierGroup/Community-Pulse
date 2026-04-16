import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { jsonErrorFromBuffer, sniffImageMime } from '../utils/imageResponseHelpers.js';
import { ArrowLeft } from 'lucide-react';
import { IS_PULSE_SURFACE } from '../config/appSurface.js';
import { DEFAULT_TAB } from '../hooks/useDocumentTitle.js';

export default function PlatformClientLayout() {
  const { orgId } = useParams();
  const location = useLocation();
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);

  const [org, setOrg] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');
  const [orgLoading, setOrgLoading] = useState(true);
  const [clientLogoUrl, setClientLogoUrl] = useState(null);
  const [logoRev, setLogoRev] = useState(0);
  const logoBlobRef = useRef(null);
  const [pulseSelectedManagerIds, setPulseSelectedManagerIds] = useState([]);
  const [pulseIncludeManagerSelf, setPulseIncludeManagerSelf] = useState(false);
  const [pulseManagerOptions, setPulseManagerOptions] = useState([]);

  const refreshOrg = useCallback(async () => {
    const { data } = await api.get(`/api/platform/organizations/${orgId}`);
    setOrg(data.organization);
    setNotFound(false);
  }, [orgId]);

  const bumpClientLogo = useCallback(() => setLogoRev((n) => n + 1), []);

  useEffect(() => {
    if (!ok || !orgId) return undefined;
    let cancelled = false;
    (async () => {
      setOrgLoading(true);
      setError('');
      try {
        await refreshOrg();
      } catch (e) {
        if (e.response?.status === 404) {
          setNotFound(true);
          setOrg(null);
        } else if (!cancelled) {
          setError(e.response?.data?.error || 'Failed to load client.');
        }
      } finally {
        if (!cancelled) setOrgLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ok, orgId, refreshOrg]);

  useEffect(() => {
    setPulseSelectedManagerIds([]);
    setPulseIncludeManagerSelf(false);
    setPulseManagerOptions([]);
  }, [orgId]);

  useEffect(() => {
    if (!org?.company_logo_filename || !orgId) {
      if (logoBlobRef.current) {
        URL.revokeObjectURL(logoBlobRef.current);
        logoBlobRef.current = null;
      }
      setClientLogoUrl(null);
      return undefined;
    }
    let cancelled = false;
    api
      .get(`/api/platform/organizations/${orgId}/logo`, {
        responseType: 'arraybuffer',
        params: { v: logoRev },
      })
      .then((res) => {
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const ab = res.data;
        if (!(ab instanceof ArrayBuffer) || ab.byteLength === 0) throw new Error('empty');
        const jsonErr = jsonErrorFromBuffer(ab);
        if (jsonErr) throw new Error(jsonErr);
        const mime = sniffImageMime(ab);
        if (!mime) throw new Error('not image');
        const ct = (res.headers['content-type'] || '').toLowerCase();
        const blobType =
          ct.startsWith('image/') && !ct.includes('json') ? ct.split(';')[0].trim() : mime;
        const blob = new Blob([ab], { type: blobType });
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        if (logoBlobRef.current) URL.revokeObjectURL(logoBlobRef.current);
        logoBlobRef.current = url;
        setClientLogoUrl(url);
      })
      .catch(() => {
        if (!cancelled) {
          if (logoBlobRef.current) {
            URL.revokeObjectURL(logoBlobRef.current);
            logoBlobRef.current = null;
          }
          setClientLogoUrl(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [org?.company_logo_filename, orgId, logoRev]);

  useEffect(() => {
    return () => {
      if (logoBlobRef.current) {
        URL.revokeObjectURL(logoBlobRef.current);
        logoBlobRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!ok || loading || !orgId) return undefined;
    const previous = document.title;
    if (notFound) {
      document.title = `Client not found | ${DEFAULT_TAB}`;
      return () => {
        document.title = previous;
      };
    }
    if (orgLoading || !org) {
      document.title = `Client · Loading… | ${DEFAULT_TAB}`;
      return () => {
        document.title = previous;
      };
    }

    const base = `/platform/clients/${orgId}`;
    const path = location.pathname;
    const tail = path.startsWith(base) ? path.slice(base.length).replace(/^\/+/, '') : '';
    let section = 'Client';
    if (!tail) {
      section = IS_PULSE_SURFACE ? 'Pulse' : 'Overview';
    } else if (tail === 'users') {
      section = 'Users';
    } else if (tail.startsWith('tasks')) {
      section = 'Tasks';
    } else if (tail === 'account') {
      section = 'Account';
    } else if (tail.startsWith('pulse/users')) {
      section = 'Pulse · Invites';
    } else if (tail.startsWith('pulse')) {
      section = 'Pulse';
    }

    const client = String(org.name || '').trim() || 'Client';
    document.title = `${section} | ${client}`;
    return () => {
      document.title = previous;
    };
  }, [ok, loading, orgId, notFound, orgLoading, org, location.pathname]);

  const navContext = useMemo(
    () => ({
      clientOrganization: org,
      pulseSelectedManagerIds,
      setPulseSelectedManagerIds,
      pulseIncludeManagerSelf,
      setPulseIncludeManagerSelf,
      pulseManagerOptions,
    }),
    [
      org,
      pulseSelectedManagerIds,
      pulseIncludeManagerSelf,
      pulseManagerOptions,
    ]
  );

  if (loading || !ok) return null;

  if (notFound) {
    return (
      <Layout user={user} onLogout={logout}>
        <p className="error">Client not found.</p>
        <Link
          to={IS_PULSE_SURFACE ? '/' : '/platform/clients'}
          className="btn btn-ghost platform-back-link"
          style={{ marginTop: '1rem' }}
        >
          <ArrowLeft size={18} aria-hidden />
          {IS_PULSE_SURFACE ? 'Back' : 'Back to clients'}
        </Link>
      </Layout>
    );
  }

  if (orgLoading || !org) {
    return (
      <Layout user={user} onLogout={logout}>
        {error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}
      </Layout>
    );
  }

  return (
    <Layout user={user} onLogout={logout} navContext={navContext}>
      <Outlet
        context={{
          org,
          orgId,
          refreshOrg,
          clientLogoUrl,
          bumpClientLogo,
          pulseSelectedManagerIds,
          setPulseSelectedManagerIds,
          pulseIncludeManagerSelf,
          setPulseIncludeManagerSelf,
          setPulseManagerOptions,
        }}
      />
    </Layout>
  );
}
