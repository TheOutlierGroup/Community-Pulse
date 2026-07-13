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

function formatSessionTimeLabel(dateValue) {
  if (!dateValue) return '';
  const dt = new Date(dateValue);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function PlatformClientLayout() {
  const { orgId } = useParams();
  const location = useLocation();
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const ok = usePlatformAccess(user, loading, navigate);

  const [org, setOrg] = useState(null);
  const [licenseConfig, setLicenseConfig] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');
  const [orgLoading, setOrgLoading] = useState(true);
  const [clientLogoUrl, setClientLogoUrl] = useState(null);
  const [logoRev, setLogoRev] = useState(0);
  const logoBlobRef = useRef(null);
  const [pulseSelectedManagerIds, setPulseSelectedManagerIds] = useState([]);
  const [pulseIncludeManagerSelf, setPulseIncludeManagerSelf] = useState(false);
  const [pulseManagerOptions, setPulseManagerOptions] = useState([]);
  const [pulseTimepoint, setPulseTimepoint] = useState('pre');
  const [pulseDuringDate, setPulseDuringDate] = useState('');
  const [pulseDuringSessionId, setPulseDuringSessionId] = useState('');
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
    setLicenseConfig(data.licenseConfig || null);
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
    setPulseTimepoint('pre');
    setPulseDuringDate('');
    setPulseDuringSessionId('');
    setPulseTimepointOptions([]);
    setPulseTimepointError('');
  }, [orgId]);

  const loadPulseTimepoints = useCallback(async () => {
    if (!orgId) return [];
    const { data } = await api.get(`/api/platform/organizations/${orgId}/rhythm-engine-sessions`);
    const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
    // Pre/Post are driven by the client's contract, set at the CRM layer
    // (Configurations → Licence) — not editable from Rhythm Engine. Only
    // fall back to the session's own creation time when no contract date
    // has been configured yet.
    const contractStartKey = sessionDateKey(licenseConfig?.contractStart);
    const contractEndKey = sessionDateKey(licenseConfig?.contractEnd);
    const normalized = sessions
      .map((session) => {
        const phase = pulseTimepointFromSession(session?.sessionPurpose);
        if (!phase) return null;
        const name = String(session?.name || '').trim();
        if (phase === 'during' && name === 'During' && session?.status === 'draft') {
          // Untouched bootstrap placeholder created by ensureDefaultPulseSessionsForOrg —
          // never a real checkpoint, so it shouldn't surface as one.
          return null;
        }
        const rawDateKey = sessionDateKey(session?.createdAt);
        if (!rawDateKey) return null;
        const labelDate = phase === 'during' && /^\d{4}-\d{2}-\d{2}$/.test(String(session?.labelDate || ''))
          ? session.labelDate
          : '';
        const contractDateKey = phase === 'pre' ? contractStartKey : phase === 'completed' ? contractEndKey : '';
        return {
          id: String(session?.id || ''),
          phase,
          dateKey: phase === 'during' ? (labelDate || rawDateKey) : (contractDateKey || rawDateKey),
          labelDate,
          isContractDate: phase !== 'during' && Boolean(contractDateKey),
          createdAt: session?.createdAt || '',
          isActive: session?.status === 'active',
          audience: session?.audience === 'manager' ? 'manager' : 'staff',
          isSystemGeneratedDuring: Boolean(session?.isSystemGeneratedDuring),
        };
      })
      .filter((row) => row && row.id);

    const preferredByPhase = ['pre', 'during', 'completed'].flatMap((phase) => {
      const rows = normalized.filter((row) => row.phase === phase);
      if (!rows.length) return [];
      const staffRows = rows.filter((row) => row.audience === 'staff');
      const selectedRows = staffRows.length > 0 ? staffRows : rows;
      return selectedRows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    });

    const duringRows = preferredByPhase.filter((row) => row.phase === 'during');
    const duringDateCounts = duringRows.reduce((acc, row) => {
      acc.set(row.dateKey, (acc.get(row.dateKey) || 0) + 1);
      return acc;
    }, new Map());

    const options = preferredByPhase.map((row) => {
      const baseLabel = formatSessionDateLabel(row.dateKey);
      const hasDuplicateDate = row.phase === 'during' && (duringDateCounts.get(row.dateKey) || 0) > 1;
      const timeLabel = hasDuplicateDate ? formatSessionTimeLabel(row.createdAt) : '';
      return {
        ...row,
        label: timeLabel ? `${baseLabel} ${timeLabel}` : baseLabel,
      };
    });
    setPulseTimepointOptions(options);

    if (options.length > 0) {
      const latestPre = options.find((row) => row.phase === 'pre');
      const activeDuring = options.find((row) => row.phase === 'during' && row.isActive);
      const latestDuring = options.find((row) => row.phase === 'during');
      const latestCompleted = options.find((row) => row.phase === 'completed');
      const fallback = latestPre || activeDuring || latestDuring || latestCompleted;
      if (fallback) {
        setPulseTimepoint(fallback.phase);
        setPulseDuringDate(fallback.phase === 'during' ? fallback.dateKey : '');
        setPulseDuringSessionId(fallback.phase === 'during' ? fallback.id : '');
      }
    }
    return options;
  }, [orgId, licenseConfig]);

  const createPulseDuringTimepoint = useCallback(async () => {
    if (!orgId) return { ok: false, error: 'Missing organization.' };
    setPulseTimepointBusy(true);
    setPulseTimepointError('');
    try {
      const { data } = await api.post(`/api/platform/organizations/${orgId}/rhythm-engine-timepoints/during`);
      const createdDate = String(data?.checkpointDate || '').trim();
      const options = await loadPulseTimepoints();
      const match = options.find((row) => row.phase === 'during' && row.dateKey === createdDate);
      const fallbackDuring = options.find((row) => row.phase === 'during');
      if (match) {
        setPulseTimepoint('during');
        setPulseDuringDate(match.dateKey);
        setPulseDuringSessionId(match.id);
      } else if (fallbackDuring) {
        setPulseTimepoint('during');
        setPulseDuringDate(fallbackDuring.dateKey || '');
        setPulseDuringSessionId(fallbackDuring.id);
      } else if (createdDate) {
        setPulseTimepoint('during');
        setPulseDuringDate(createdDate);
        setPulseDuringSessionId('');
      }
      return { ok: true };
    } catch (e) {
      const message = e?.response?.data?.error || 'Could not create a new during checkpoint.';
      setPulseTimepointError(message);
      return { ok: false, error: message };
    } finally {
      setPulseTimepointBusy(false);
    }
  }, [orgId, loadPulseTimepoints]);

  const deletePulseDuringTimepoint = useCallback(async (sessionId) => {
    if (!orgId || !sessionId) return { ok: false, error: 'Missing checkpoint.' };
    setPulseTimepointBusy(true);
    setPulseTimepointError('');
    try {
      await api.delete(`/api/platform/organizations/${orgId}/rhythm-engine-timepoints/during/${sessionId}`);
      await loadPulseTimepoints();
      return { ok: true };
    } catch (e) {
      const message = e?.response?.data?.error || 'Could not delete during checkpoint.';
      setPulseTimepointError(message);
      return { ok: false, error: message };
    } finally {
      setPulseTimepointBusy(false);
    }
  }, [orgId, loadPulseTimepoints]);

  const updatePulseSessionLabelDate = useCallback(async (sessionId, labelDate) => {
    if (!orgId || !sessionId) return { ok: false, error: 'Missing checkpoint.' };
    setPulseTimepointBusy(true);
    setPulseTimepointError('');
    try {
      await api.patch(`/api/platform/organizations/${orgId}/rhythm-engine-sessions/${sessionId}/label-date`, {
        labelDate: labelDate || null,
      });
      await loadPulseTimepoints();
      return { ok: true };
    } catch (e) {
      const message = e?.response?.data?.error || 'Could not update the point-in-time date.';
      setPulseTimepointError(message);
      return { ok: false, error: message };
    } finally {
      setPulseTimepointBusy(false);
    }
  }, [orgId, loadPulseTimepoints]);

  useEffect(() => {
    if (pulseTimepoint !== 'during') return;
    if (pulseDuringSessionId) return;
    const fallbackDuring = pulseTimepointOptions.find((row) => row.phase === 'during' && row.id);
    if (!fallbackDuring) return;
    setPulseDuringSessionId(fallbackDuring.id);
    setPulseDuringDate(fallbackDuring.dateKey || '');
  }, [pulseTimepoint, pulseDuringSessionId, pulseTimepointOptions]);

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
          setPulseDuringSessionId('');
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
    } else if (tail === 'projects') {
      section = 'Projects';
    } else if (tail === 'activity') {
      section = 'Recent activity';
    } else if (tail === 'account') {
      section = 'Configurations';
    } else if (tail === 'my-account') {
      section = 'Account';
    } else if (tail.startsWith('rhythm-engine/users')) {
      section = 'Rhythm Engine · Invites';
    } else if (tail.startsWith('rhythm-engine/settings')) {
      section = 'Rhythm Engine · Settings';
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
      pulseDuringSessionId,
      setPulseDuringSessionId,
      pulseTimepointOptions,
      pulseTimepointBusy,
      pulseTimepointError,
      trendAnalysisVisible,
    }),
    [
      org,
      pulseSelectedManagerIds,
      pulseIncludeManagerSelf,
      pulseManagerOptions,
      pulseTimepoint,
      pulseDuringDate,
      pulseDuringSessionId,
      pulseTimepointOptions,
      pulseTimepointBusy,
      pulseTimepointError,
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
          licenseConfig,
          clientLogoUrl,
          bumpClientLogo,
          pulseSelectedManagerIds,
          setPulseSelectedManagerIds,
          pulseIncludeManagerSelf,
          setPulseIncludeManagerSelf,
          setPulseManagerOptions,
          pulseTimepoint,
          pulseDuringDate,
          pulseDuringSessionId,
          pulseTimepointOptions,
          pulseTimepointBusy,
          pulseTimepointError,
          createPulseDuringTimepoint,
          deletePulseDuringTimepoint,
          updatePulseSessionLabelDate,
          trendAnalysisVisible,
        }}
      />
    </Layout>
  );
}
