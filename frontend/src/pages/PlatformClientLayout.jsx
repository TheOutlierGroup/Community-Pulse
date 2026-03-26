import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { jsonErrorFromBuffer, sniffImageMime } from '../utils/imageResponseHelpers.js';
import { ArrowLeft } from 'lucide-react';

export default function PlatformClientLayout() {
  const { orgId } = useParams();
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

  const navContext = useMemo(() => ({ clientOrganization: org }), [org]);

  if (loading || !ok) return null;

  if (notFound) {
    return (
      <Layout user={user} onLogout={logout}>
        <p className="error">Client not found.</p>
        <Link to="/platform/clients" className="btn btn-ghost platform-back-link" style={{ marginTop: '1rem' }}>
          <ArrowLeft size={18} aria-hidden />
          Back to clients
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
      <Outlet context={{ org, orgId, refreshOrg, clientLogoUrl, bumpClientLogo }} />
    </Layout>
  );
}
