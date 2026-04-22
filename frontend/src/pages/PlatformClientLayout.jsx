import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../components/shared/Auth.jsx';
import Layout from '../components/shared/Layout.jsx';
import { usePlatformAccess } from '../hooks/usePlatformAccess.js';
import { jsonErrorFromBuffer, sniffImageMime } from '../utils/imageResponseHelpers.js';
import { ArrowLeft } from 'lucide-react';
import { IS_RHYTHM_ENGINE_SURFACE } from '../config/appSurface.js';
import { DEFAULT_TAB } from '../hooks/useDocumentTitle.js';
import { trendAnalysisVisibleFromOptions } from './pulseNavigationRules.js';

function pulseTimepointFromSession(sessionPurpose) {
  const normalized = String(sessionPurpose || '').trim().toLowerCase();
  if (normalized === 'pre_project') return 'pre';
  if (normalized === 'completed_project') return 'completed';
  if (normalized === 'link_invite') return null;
  return 'during';
}

function sessionDateKey(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

function formatSessionDateLabel(dateKey) {
  if (!dateKey) return 'Unknown date';
  const dt = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(dt.getTime())) return dateKey;
  return dt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

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
  const [pulseTimepoint, setPulseTimepoint] = useState('during');
  const [pulseDuringDate, setPulseDuringDate] = useState('');
  const [pulseTimepointOptions, setPulseTimepointOptions] = useState([]);
  const [pulseTimepointBusy, setPulseTimepointBusy] = useState(false);
  const [pulseTimepointError, setPulseTimepointError] = useState('');
  const trendAnalysisVisible = useMemo(
    () => trendAnalysisVisibleFromOptions(pulseTimepointOptions),
    [pulseTimepointOptions]
  );

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
    setPulseTimepoint('during');
    setPulseDuringDate('');
    setPulseTimepointOptions([]);
    setPulseTimepointError('');
  }, [orgId]);

  const loadPulseTimepoints = useCallback(async () => {
    if (!orgId) return [];
    const { data } = await api.get(`/api/platform/organizations/${orgId}/rhythm-engine-sessions`);
    const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
    const grouped = new Map();
    sessions.forEach((session) => {
      const phase = pulseTimepointFromSession(session?.sessionPurpose);
      if (!phase) return;
      const key = sessionDateKey(session?.createdAt);
      if (!key) return;
      const groupKey = `${phase}:${key}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          id: groupKey,
          phase,
          dateKey: key,
          label: formatSessionDateLabel(key),
          isActive: false,
          count: 0,
        });
      }
      const row = grouped.get(groupKey);
      row.count += 1;
      if (session?.status === 'active') row.isActive = true;
    });
    const options = [...grouped.values()].sort((a, b) => b.dateKey.localeCompare(a.dateKey));
    setPulseTimepointOptions(options);

    if (options.length > 0) {
      const activeDuring = options.find((row) => row.phase === 'during' && row.isActive);
      const latestDuring = options.find((row) => row.phase === 'during');
      const latestPre = options.find((row) => row.phase === 'pre');
      const latestCompleted = options.find((row) => row.phase === 'completed');
      const fallback = activeDuring || latestDuring || latestPre || latestCompleted;
      if (fallback) {
        setPulseTimepoint(fallback.phase);
        setPulseDuringDate(fallback.phase === 'during' ? fallback.dateKey : '');
      }
    }
    return options;
  }, [orgId]);

  const createPulseDuringTimepoint = useCallback(async () => {
    if (!orgId) return;
    setPulseTimepointBusy(true);
    setPulseTimepointError('');
    try {
      const { data } = await api.post(`/api/platform/organizations/${orgId}/rhythm-engine-timepoints/during`);
      const createdDate = String(data?.checkpointDate || '').trim();
      const options = await loadPulseTimepoints();
      const match = options.find((row) => row.phase === 'during' && row.dateKey === createdDate);
      if (match) {
        setPulseTimepoint('during');
        setPulseDuringDate(match.dateKey);
      } else if (createdDate) {
        setPulseTimepoint('during');
        setPulseDuringDate(createdDate);
      }
    } catch (e) {
      setPulseTimepointError(e?.response?.data?.error || 'Could not create a new during checkpoint.');
    } finally {
      setPulseTimepointBusy(false);
    }
  }, [orgId, loadPulseTimepoints]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      try {
        await loadPulseTimepoints();
        if (!cancelled) setPulseTimepointError('');
      } catch (e) {
        if (!cancelled) {
          setPulseTimepointOptions([]);
          setPulseTimepointError(e?.response?.data?.error || 'Could not load Rhythm Engine timepoints.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, loadPulseTimepoints]);

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
      section = IS_RHYTHM_ENGINE_SURFACE ? 'Rhythm Engine' : 'Overview';
    } else if (tail === 'users') {
      section = 'Users';
    } else if (tail.startsWith('tasks')) {
      section = 'Tasks';
    } else if (tail === 'account') {
      section = 'Account';
    } else if (tail.startsWith('rhythm-engine/users')) {
      section = 'Rhythm Engine · Invites';
    } else if (tail.startsWith('rhythm-engine')) {
      section = 'Rhythm Engine';
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
      pulseTimepoint,
      setPulseTimepoint,
      pulseDuringDate,
      setPulseDuringDate,
      pulseTimepointOptions,
      pulseTimepointBusy,
      pulseTimepointError,
      createPulseDuringTimepoint,
      trendAnalysisVisible,
    }),
    [
      org,
      pulseSelectedManagerIds,
      pulseIncludeManagerSelf,
      pulseManagerOptions,
      pulseTimepoint,
      pulseDuringDate,
      pulseTimepointOptions,
      pulseTimepointBusy,
      pulseTimepointError,
      createPulseDuringTimepoint,
      trendAnalysisVisible,
    ]
  );

  if (loading || !ok) return null;

  if (notFound) {
    return (
      <Layout user={user} onLogout={logout}>
        <p className="error">Client not found.</p>
        <Link
          to={IS_RHYTHM_ENGINE_SURFACE ? '/' : '/platform/clients'}
          className="btn btn-ghost platform-back-link"
          style={{ marginTop: '1rem' }}
        >
          <ArrowLeft size={18} aria-hidden />
          {IS_RHYTHM_ENGINE_SURFACE ? 'Back' : 'Back to clients'}
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
          pulseTimepoint,
          pulseDuringDate,
          pulseTimepointOptions,
          trendAnalysisVisible,
        }}
      />
    </Layout>
  );
}
