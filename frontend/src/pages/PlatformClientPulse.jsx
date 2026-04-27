import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useOutletContext } from 'react-router-dom';
import api from '../services/api.js';
import { normalizeServices } from './platformClientUtils.js';
import { resolvePulseFocusedSection } from './pulseNavigationRules.js';
import ReportGeneratorModal from '../components/platform/ReportGeneratorModal.jsx';

const PULSE_DASHBOARD_RETRY_DELAYS_MS = [500, 1200, 2500, 4500];
const QUADRANT_ORDER = ['Motivated but Lost', 'Optimal', 'High Risk', 'Capable but Wary'];

function formatScore(value) {
  if (value == null || Number.isNaN(value)) return '--';
  return value.toFixed(1);
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '0%';
  return `${Math.round(value)}%`;
}

function formatDelta(value) {
  if (value == null || Number.isNaN(value)) return '--';
  if (value > 0) return `+${value.toFixed(1)}`;
  if (value < 0) return value.toFixed(1);
  return '0.0';
}

function deltaTone(value) {
  if (value == null || Number.isNaN(value) || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}

function formatPulseTimepointLabel(timepoint, duringDate, includeDuringDate = false) {
  if (timepoint === 'pre') return 'Pre';
  if (timepoint === 'completed') return 'Post';
  if (timepoint === 'during') {
    if (!includeDuringDate || !duringDate) return 'During';
    const dt = new Date(`${duringDate}T00:00:00.000Z`);
    if (Number.isNaN(dt.getTime())) return `During - ${duringDate}`;
    return `During - ${dt.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    })}`;
  }
  return 'During';
}

function formatReportStage(stage) {
  if (stage === 'pre') return 'Pre-Change';
  if (stage === 'mid') return 'Mid-Change';
  if (stage === 'post') return 'Post-Change';
  return stage || '--';
}

function formatReportAuthor(author) {
  if (!author) return 'Unknown';
  const fullName = [author.first_name, author.last_name].filter(Boolean).join(' ').trim();
  return fullName || author.email || 'Unknown';
}

function pause(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function shouldRetryPulseDashboardRequest(err) {
  const status = err?.response?.status;
  if (status == null) return true;
  if (status === 429) return true;
  return status >= 500;
}

function parseRetryDelayMs(err, fallbackMs) {
  const headers = err?.response?.headers || {};
  const retryAfterRaw = headers['retry-after'];
  if (retryAfterRaw != null) {
    const asNumber = Number.parseFloat(String(retryAfterRaw).trim());
    if (Number.isFinite(asNumber) && asNumber >= 0) {
      return Math.round(asNumber * 1000);
    }
    const asDateMs = Date.parse(String(retryAfterRaw));
    if (Number.isFinite(asDateMs)) {
      const delta = Math.max(0, asDateMs - Date.now());
      if (delta > 0) return delta;
    }
  }

  const rateLimitResetRaw = headers['ratelimit-reset'];
  if (rateLimitResetRaw != null) {
    const asNumber = Number.parseFloat(String(rateLimitResetRaw).trim());
    if (Number.isFinite(asNumber) && asNumber >= 0) {
      return Math.round(asNumber * 1000);
    }
  }

  return fallbackMs;
}

function pulseDashboardErrorText(err, attemptCount = 1) {
  const status = err?.response?.status;
  const apiMessage = typeof err?.response?.data?.error === 'string' ? err.response.data.error.trim() : '';
  if (status === 401 || status === 403) {
    return 'Your session has expired. Please sign in again.';
  }
  if (status === 404) {
    return 'Rhythm Engine dashboard is not available for this client yet.';
  }
  if (status === 429) {
    return attemptCount > 1
      ? 'Rhythm Engine dashboard is temporarily rate limited after multiple retries. Please wait a moment and refresh.'
      : 'Rhythm Engine dashboard is temporarily rate limited. Please wait a moment and refresh.';
  }
  if (apiMessage) {
    return attemptCount > 1
      ? `Could not load Rhythm Engine dashboard data after retrying. ${apiMessage}`
      : `Could not load Rhythm Engine dashboard data. ${apiMessage}`;
  }
  return attemptCount > 1
    ? 'Could not load Rhythm Engine dashboard data after retrying. Please try again.'
    : 'Could not load Rhythm Engine dashboard data. Please try again.';
}

async function fetchPulseDashboardWithRetry(orgId, params) {
  let lastError = null;
  const maxAttempts = PULSE_DASHBOARD_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await api.get(`/api/platform/organizations/${orgId}/rhythm-engine-dashboard`, { params });
      return { response, attempts: attempt };
    } catch (err) {
      lastError = err;
      const canRetry = attempt < maxAttempts && shouldRetryPulseDashboardRequest(err);
      if (!canRetry) break;
      const fallbackDelay = PULSE_DASHBOARD_RETRY_DELAYS_MS[attempt - 1] || 5000;
      const delayMs = parseRetryDelayMs(err, fallbackDelay);
      await pause(delayMs);
    }
  }
  const wrappedError = new Error('Rhythm Engine dashboard request failed');
  wrappedError.originalError = lastError;
  wrappedError.retryAttempts = Math.max(1, maxAttempts);
  throw wrappedError;
}

function sectionLabel(sectionId) {
  if (sectionId === 'organisation-scores') return 'Organisation Scores';
  if (sectionId === 'trend-analysis') return 'Trend Analysis';
  if (sectionId === 'sponsorship-analysis') return 'Sponsorship Analysis';
  if (sectionId === 'employee-breakdown') return 'Employee Breakdown';
  if (sectionId === 'team-level-view') return 'Team-Level View';
  if (sectionId === 'reports') return 'Reports';
  return 'Organisation Dashboard';
}

function quadrantTone(name) {
  if (name === 'Optimal') return 'optimal';
  if (name === 'Motivated but Lost') return 'motivated';
  if (name === 'Capable but Wary') return 'wary';
  return 'risk';
}

function normalizeInviteTimepoint(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'during') return 'mid';
  if (raw === 'completed') return 'post';
  if (raw === 'pre' || raw === 'mid' || raw === 'post') return raw;
  return 'pre';
}

function majorityLabel(values, fallback = '--') {
  const counts = new Map();
  values.forEach((value) => {
    const label = String(value || '').trim();
    if (!label) return;
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  if (counts.size === 0) return fallback;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function heatTone(value) {
  if (value == null || Number.isNaN(value)) return 'h1';
  if (value >= 4.0) return 'h5';
  if (value >= 3.5) return 'h4';
  if (value >= 3.0) return 'h3';
  if (value >= 2.5) return 'h2';
  return 'h1';
}

function loadBandClassName(label) {
  return String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function managerChainStatus(quadrant) {
  if (quadrant === 'Optimal') return 'Chain Functioning';
  if (quadrant === 'Motivated but Lost') return 'Resilient, Under-supported';
  if (quadrant === 'Capable but Wary') return 'At-Risk Leadership';
  return 'Failed at Both Levels';
}

export default function PlatformClientPulse() {
  const {
    org,
    orgId,
    pulseSelectedManagerIds: selectedManagerIds,
    setPulseSelectedManagerIds,
    pulseIncludeManagerSelf: includeManagerSelf,
    setPulseManagerOptions,
    pulseTimepoint,
    pulseDuringDate,
    pulseDuringSessionId,
    pulseTimepointOptions,
    trendAnalysisVisible,
  } = useOutletContext();
  const location = useLocation();

  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeDimensionTab, setActiveDimensionTab] = useState('employee');
  const [groupInviteMap, setGroupInviteMap] = useState({});
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsError, setReportsError] = useState('');
  const loadRequestIdRef = useRef(0);

  const enabledServices = normalizeServices(org.settings);
  const pulseEnabled = enabledServices.includes('pulse');
  const pulseFocusedSection = useMemo(
    () => resolvePulseFocusedSection(location.hash, trendAnalysisVisible),
    [location.hash, trendAnalysisVisible]
  );
  const pageTitle = sectionLabel(pulseFocusedSection);
  const showingFullDashboard = pulseFocusedSection == null;
  const showReadinessSection = showingFullDashboard || pulseFocusedSection === 'organisation-scores';
  const showScoresSection = showingFullDashboard
    || pulseFocusedSection === 'organisation-scores'
    || pulseFocusedSection === 'sponsorship-analysis';
  const showDimensionsSection = showingFullDashboard
    || pulseFocusedSection === 'employee-breakdown'
    || pulseFocusedSection === 'trend-analysis';
  const showTeamLevelSection = showingFullDashboard || pulseFocusedSection === 'team-level-view';
  const showReportsSection = pulseFocusedSection === 'reports';
  const kpis = dashboard?.kpis || {};
  const scoreSemantics = dashboard?.scoreSemantics || {};
  const quadrants = useMemo(() => {
    const source = dashboard?.quadrants || [];
    return QUADRANT_ORDER.map((name) => source.find((q) => q.name === name) || { name, percent: 0 });
  }, [dashboard?.quadrants]);
  const optimalPercent = quadrants.find((q) => q.name === 'Optimal')?.percent ?? 0;
  const remainingPercent = Math.max(0, 100 - optimalPercent);
  const insightCards = (dashboard?.alerts || []).slice(0, 3);
  const sponsorshipSignals = dashboard?.sponsorshipAnalysis?.signals || null;
  const threshold = Number.isFinite(scoreSemantics.threshold) ? scoreSemantics.threshold : 28;
  const adoptionScore = Number.isFinite(kpis.adoptionScore) ? kpis.adoptionScore : null;
  const sponsorshipScore = Number.isFinite(kpis.sponsorshipScore) ? kpis.sponsorshipScore : null;
  const managerBreakdownRows = dashboard?.byManager || [];
  const dimensions = dashboard?.dimensions || [];
  const trendBars = useMemo(
    () => [...(dashboard?.trend || []).slice(0, 4)].reverse(),
    [dashboard?.trend]
  );
  const employeeDimensions = useMemo(
    () => dimensions.map((dimension) => ({
      id: dimension.id,
      label: dimension.label,
      avg: dimension.energyAvg,
      highPercent: dimension.highEnergyPercent,
    })),
    [dimensions]
  );
  const managerDimensions = useMemo(
    () => dimensions.map((dimension) => ({
      id: dimension.id,
      label: dimension.managerLabel || dimension.label,
      avg: dimension.frictionAvg,
      highPercent: dimension.managerHighPercent ?? dimension.highEnergyPercent,
    })),
    [dimensions]
  );
  const activeDimensionRows = activeDimensionTab === 'employee' ? employeeDimensions : managerDimensions;
  const trendMax = Math.max(
    40,
    ...trendBars.flatMap((item) => [item?.adoptionScore || 0, item?.sponsorshipScore || 0])
  );
  const managerLoadDistribution = useMemo(() => {
    const total = managerBreakdownRows.length;
    const bands = ['Sustainable', 'Stretched', 'At Capacity', 'Overloaded'];
    return bands.map((band) => {
      const count = managerBreakdownRows.filter((row) => String(row?.managerLoadBand || '').trim() === band).length;
      const percent = total > 0 ? (count / total) * 100 : 0;
      return { band, count, percent };
    });
  }, [managerBreakdownRows]);
  const criticalLoadPercent = managerLoadDistribution
    .filter((item) => item.band === 'At Capacity' || item.band === 'Overloaded')
    .reduce((sum, item) => sum + item.percent, 0);
  const sponsorshipGap = adoptionScore == null || sponsorshipScore == null
    ? null
    : (adoptionScore - sponsorshipScore);
  const interventionRequired = (sponsorshipScore != null && sponsorshipScore < threshold)
    || criticalLoadPercent >= 35
    || optimalPercent < 25;
  const sponsorshipVerdict = interventionRequired ? 'Intervention Required' : 'Chain Stable';
  const sponsorshipExecutiveSignal = interventionRequired
    ? 'Managers are absorbing pressure from both directions and need targeted sponsorship support.'
    : 'Sponsorship coverage is broadly holding; continue monitoring manager load pressure.';
  const chainStatusDistribution = useMemo(() => {
    const statuses = [
      'Chain Functioning',
      'Resilient, Under-supported',
      'At-Risk Leadership',
      'Failed at Both Levels',
    ];
    const total = managerBreakdownRows.length;
    const counts = managerBreakdownRows.reduce((acc, row) => {
      const status = managerChainStatus(String(row?.quadrant || '').trim());
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    return statuses.map((status) => {
      const count = counts[status] || 0;
      return {
        status,
        count,
        percent: total > 0 ? (count / total) * 100 : 0,
      };
    });
  }, [managerBreakdownRows]);
  const loadByChainMatrix = useMemo(() => {
    const bands = ['Sustainable', 'Stretched', 'At Capacity', 'Overloaded'];
    const statuses = [
      'Chain Functioning',
      'Resilient, Under-supported',
      'At-Risk Leadership',
      'Failed at Both Levels',
    ];
    const rows = bands.map((band) => ({
      band,
      cells: statuses.reduce((acc, status) => ({ ...acc, [status]: 0 }), {}),
      total: 0,
    }));
    const rowMap = new Map(rows.map((row) => [row.band, row]));

    managerBreakdownRows.forEach((row) => {
      const band = String(row?.managerLoadBand || '').trim();
      const matrixRow = rowMap.get(band);
      if (!matrixRow) return;
      const status = managerChainStatus(String(row?.quadrant || '').trim());
      matrixRow.cells[status] += 1;
      matrixRow.total += 1;
    });

    return { rows, statuses };
  }, [managerBreakdownRows]);
  const groupLevelLabels = useMemo(() => {
    const labels = Array.isArray(org?.settings?.groupLevelLabels) ? org.settings.groupLevelLabels : [];
    return labels.map((value) => String(value || '').trim()).filter(Boolean);
  }, [org?.settings?.groupLevelLabels]);
  const groupedTeamRows = useMemo(() => {
    if (!managerBreakdownRows.length) return [];

    const createNode = (name, depth = 0) => ({
      name,
      depth,
      children: new Map(),
      managers: [],
      aggregate: null,
    });
    const root = createNode('root', -1);

    managerBreakdownRows.forEach((managerRow) => {
      const managerGroups = Array.isArray(groupInviteMap?.[managerRow.managerId])
        ? groupInviteMap[managerRow.managerId]
        : [];
      const path = managerGroups
        .map((value) => String(value || '').trim())
        .filter(Boolean);
      const normalizedPath = path.length > 0 ? path : ['Unassigned'];

      let cursor = root;
      normalizedPath.forEach((segment, index) => {
        if (!cursor.children.has(segment)) {
          cursor.children.set(segment, createNode(segment, index));
        }
        cursor = cursor.children.get(segment);
      });
      cursor.managers.push(managerRow);
    });

    const aggregateNode = (node) => {
      const childAggregates = [...node.children.values()].map(aggregateNode);
      const ownManagers = node.managers;
      const allManagers = [...ownManagers, ...childAggregates.flatMap((item) => item.allManagers)];
      const weightedRows = allManagers.map((row) => {
        const weight = Math.max(1, Number(row.directReportCompletedCount || row.completedResponses || 0));
        return { row, weight };
      });
      const totalWeight = weightedRows.reduce((sum, item) => sum + item.weight, 0);
      const weightedAverage = (selector) => {
        if (!weightedRows.length || totalWeight <= 0) return null;
        const numerator = weightedRows.reduce((sum, item) => {
          const value = selector(item.row);
          if (value == null || Number.isNaN(value)) return sum;
          return sum + (value * item.weight);
        }, 0);
        return numerator / totalWeight;
      };

      const trend = [0, 1, 2, 3].map((index) => {
        const values = weightedRows
          .map((item) => {
            const score = item.row?.trend?.[index]?.adoptionScore;
            if (score == null || Number.isNaN(score)) return null;
            return { score, weight: item.weight };
          })
          .filter(Boolean);
        if (!values.length) return null;
        const sumWeight = values.reduce((sum, value) => sum + value.weight, 0);
        if (sumWeight <= 0) return null;
        return values.reduce((sum, value) => sum + (value.score * value.weight), 0) / sumWeight;
      });

      node.aggregate = {
        allManagers,
        responses: allManagers.reduce((sum, row) => sum + (row.directReportCompletedCount || 0), 0),
        adoption: weightedAverage((row) => row.adoptionScore),
        sponsorship: weightedAverage((row) => row.sponsorshipScore),
        loadBand: majorityLabel(allManagers.map((row) => row.managerLoadBand), '--'),
        quadrant: majorityLabel(allManagers.map((row) => row.quadrant), '--'),
        trend,
      };
      return node.aggregate;
    };

    aggregateNode(root);

    const flattened = [];
    const walk = (node) => {
      const children = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
      children.forEach((child) => {
        flattened.push({
          key: `${child.depth}-${child.name}`,
          depth: child.depth,
          name: child.name,
          ...child.aggregate,
        });
        walk(child);
      });
    };
    walk(root);
    return flattened;
  }, [groupInviteMap, managerBreakdownRows]);
  const todayLabel = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const orderedDuringOptions = useMemo(
    () => (Array.isArray(pulseTimepointOptions)
      ? pulseTimepointOptions.filter((option) => option.phase === 'during')
      : []),
    [pulseTimepointOptions]
  );
  const selectedDuringIndex = useMemo(() => {
    if (pulseTimepoint !== 'during') return -1;
    if (!orderedDuringOptions.length) return -1;
    if (pulseDuringSessionId) {
      return orderedDuringOptions.findIndex((option) => option.id === pulseDuringSessionId);
    }
    if (pulseDuringDate) {
      return orderedDuringOptions.findIndex((option) => option.dateKey === pulseDuringDate);
    }
    return -1;
  }, [orderedDuringOptions, pulseDuringDate, pulseDuringSessionId, pulseTimepoint]);
  const selectedDuringOption = selectedDuringIndex >= 0 ? orderedDuringOptions[selectedDuringIndex] : null;
  const includeSelectedDuringDate = Boolean(selectedDuringOption && !selectedDuringOption.isSystemGeneratedDuring);
  const selectedTimepointLabel = formatPulseTimepointLabel(
    pulseTimepoint,
    pulseDuringDate,
    includeSelectedDuringDate
  );

  useEffect(() => {
    const previous = document.title;
    const client = String(org?.name ?? '').trim() || 'Client';
    document.title = `Rhythm Engine · ${pageTitle} | ${client}`;
    return () => {
      document.title = previous;
    };
  }, [pageTitle, org?.name]);

  const loadDashboard = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    setLoading(true);
    setError('');

    const params = {};
    if (pulseTimepoint === 'pre' || pulseTimepoint === 'during' || pulseTimepoint === 'completed') {
      params.timepoint = pulseTimepoint;
    }
    if (pulseTimepoint === 'during' && pulseDuringDate) {
      params.duringDate = pulseDuringDate;
    }
    if (pulseTimepoint === 'during' && pulseDuringSessionId) {
      params.duringSessionId = pulseDuringSessionId;
    }
    if (selectedManagerIds.length > 0) {
      params.managerIds = selectedManagerIds.join(',');
      params.includeManagerSelf = includeManagerSelf ? 'true' : 'false';
    }

    try {
      const { response } = await fetchPulseDashboardWithRetry(orgId, params);
      if (requestId !== loadRequestIdRef.current) return;

      const data = response?.data || null;
      setDashboard(data);
      setPulseManagerOptions(data?.managers || []);

      if (typeof setPulseSelectedManagerIds === 'function') {
        const availableIds = new Set((data?.managers || []).map((m) => m.id));
        setPulseSelectedManagerIds((current) => {
          const list = Array.isArray(current) ? current : [];
          const filtered = list.filter((id) => availableIds.has(id));
          const unchanged =
            filtered.length === list.length && filtered.every((id, idx) => id === list[idx]);
          return unchanged ? list : filtered;
        });
      }
    } catch (failure) {
      if (requestId !== loadRequestIdRef.current) return;
      const cause = failure?.originalError || failure;
      const attempts = Number(failure?.retryAttempts || 1);
      setError(pulseDashboardErrorText(cause, attempts));
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [
    orgId,
    pulseTimepoint,
    pulseDuringDate,
    pulseDuringSessionId,
    selectedManagerIds,
    includeManagerSelf,
    setPulseManagerOptions,
    setPulseSelectedManagerIds,
  ]);

  useEffect(() => {
    if (!pulseEnabled) return;
    loadDashboard();
  }, [pulseEnabled, loadDashboard]);

  useEffect(() => {
    if (!pulseEnabled) return;
    let cancelled = false;

    (async () => {
      try {
        const timepoint = normalizeInviteTimepoint(pulseTimepoint);
        const params = { timepoint };
        if (timepoint === 'mid' && pulseDuringSessionId) {
          params.duringSessionId = pulseDuringSessionId;
        }
        const { data } = await api.get(
          `/api/platform/organizations/${orgId}/rhythm-engine-link-invites`,
          { params }
        );
        if (cancelled) return;
        const rows = Array.isArray(data?.invites) ? data.invites : [];
        const nextMap = {};
        rows
          .filter((row) => row?.surveyRole === 'manager')
          .forEach((row) => {
            nextMap[row.id] = Array.isArray(row.groupValues) ? row.groupValues : [];
          });
        setGroupInviteMap(nextMap);
      } catch {
        if (!cancelled) setGroupInviteMap({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orgId, pulseEnabled, pulseTimepoint, pulseDuringSessionId]);

  const loadReports = useCallback(async () => {
    if (!pulseEnabled) {
      setReports([]);
      setReportsError('');
      setReportsLoading(false);
      return;
    }

    setReportsLoading(true);
    setReportsError('');
    try {
      const { data } = await api.get('/api/reports', {
        params: { org_id: orgId, limit: 50 },
      });
      setReports(Array.isArray(data?.reports) ? data.reports : []);
    } catch (requestError) {
      setReports([]);
      setReportsError(requestError?.response?.data?.error || 'Could not load report history.');
    } finally {
      setReportsLoading(false);
    }
  }, [orgId, pulseEnabled]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  async function downloadPastReport(reportId) {
    setReportsError('');
    try {
      const response = await api.get(`/api/reports/${reportId}`, {
        responseType: 'blob',
      });
      const blob = new Blob([response.data], {
        type: response?.headers?.['content-type'] || 'application/octet-stream',
      });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = `${org.slug || org.id}-report`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setReportsError('Could not download report.');
    }
  }

  if (!pulseEnabled) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Rhythm Engine</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          Rhythm Engine is not enabled for this client.
        </p>
      </div>
    );
  }

  return (
    <>
      <section className="pulse-clean-header card">
        <div className="pulse-clean-header__top">
          <div>
            <p className="pulse-clean-header__eyebrow">Client Administration</p>
            <h2 className="pulse-clean-header__title">{pageTitle}</h2>
            <p className="pulse-clean-header__timepoint">{selectedTimepointLabel}</p>
          </div>
          <div className="pulse-clean-header__meta">
            <span className="pulse-clean-header__chip">Client Worksheets</span>
            <span className="pulse-clean-header__chip">Results {new Date().getFullYear()}</span>
            <span className="pulse-clean-header__chip">Reports</span>
            <span className="pulse-clean-header__date">{todayLabel}</span>
            <button type="button" className="btn btn-ghost" onClick={loadDashboard} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        <div className="pulse-clean-header__kpis">
          <div className="pulse-clean-header__kpi">
            <p className="pulse-clean-header__kpi-label">Total Responses</p>
            <p className="pulse-clean-header__kpi-value">{kpis.completedTotal ?? 0}</p>
            <p className="pulse-clean-header__kpi-meta">of {kpis.invitedTotal ?? 0} invited</p>
            <p className={`pulse-clean-header__kpi-delta pulse-clean-header__kpi-delta--${deltaTone(kpis.participationRate)}`}>
              {formatPercent(kpis.participationRate)}
            </p>
          </div>
          <div className="pulse-clean-header__kpi">
            <p className="pulse-clean-header__kpi-label">Employee Responses</p>
            <p className="pulse-clean-header__kpi-value">{kpis.completedEmployees ?? 0}</p>
            <p className="pulse-clean-header__kpi-meta">of {kpis.invitedEmployees ?? 0}</p>
          </div>
          <div className="pulse-clean-header__kpi">
            <p className="pulse-clean-header__kpi-label">Manager Responses</p>
            <p className="pulse-clean-header__kpi-value">{kpis.completedManagers ?? 0}</p>
            <p className="pulse-clean-header__kpi-meta">of {kpis.invitedManagers ?? 0}</p>
          </div>
          <div className="pulse-clean-header__kpi">
            <p className="pulse-clean-header__kpi-label">Avg Adoption Score</p>
            <p className="pulse-clean-header__kpi-value">{formatScore(kpis.adoptionScore)}</p>
            <p className="pulse-clean-header__kpi-meta">/40 this timepoint</p>
            <p className={`pulse-clean-header__kpi-delta pulse-clean-header__kpi-delta--${deltaTone(kpis.adoptionDelta)}`}>
              {formatDelta(kpis.adoptionDelta)}
            </p>
          </div>
          <div className="pulse-clean-header__kpi">
            <p className="pulse-clean-header__kpi-label">Avg Sponsorship Score</p>
            <p className="pulse-clean-header__kpi-value">{formatScore(kpis.sponsorshipScore)}</p>
            <p className="pulse-clean-header__kpi-meta">/40 this timepoint</p>
            <p className={`pulse-clean-header__kpi-delta pulse-clean-header__kpi-delta--${deltaTone(kpis.sponsorshipDelta)}`}>
              {formatDelta(kpis.sponsorshipDelta)}
            </p>
          </div>
        </div>

        <div className="pulse-clean-header__summary">
          <div>
            <p className="pulse-clean-header__summary-title">
              {kpis.launchHeadline || '--'}
            </p>
            <p className="pulse-clean-header__summary-text">
              {dashboard?.soWhatStatus === 'unavailable'
                ? 'AI summary unavailable for this timepoint.'
                : (dashboard?.soWhat || dashboard?.narrative || '--')}
            </p>
          </div>
          <span className="pulse-clean-header__badge">
            {kpis.launchVerdict === 'cleared' ? 'Cleared for launch' : 'Not Cleared for Launch'}
          </span>
        </div>
      </section>

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Loading dashboard data...</p> : null}

      {showReadinessSection ? (
        <section className="pulse-clean-readiness card">
        <div className="pulse-clean-readiness__top">
          <div className="pulse-clean-readiness__quadrants">
            {quadrants.map((quadrant) => (
              <div
                key={quadrant.name}
                className={`pulse-clean-readiness__quadrant pulse-clean-readiness__quadrant--${quadrantTone(quadrant.name)}`}
              >
                <p className="pulse-clean-readiness__quadrant-percent">{formatPercent(quadrant.percent)}</p>
                <p className="pulse-clean-readiness__quadrant-name">{quadrant.name}</p>
              </div>
            ))}
          </div>
          <p className="pulse-clean-readiness__statement">
            Only {formatPercent(optimalPercent)} of respondents are in a position to absorb and sustain this change
            without additional intervention. The remaining {formatPercent(remainingPercent)} are distributed across
            three readiness states.
          </p>
        </div>

        <div className="pulse-clean-readiness__cards">
          {insightCards.length > 0 ? (
            insightCards.map((card) => (
              <article key={card.title} className="pulse-clean-readiness__card">
                <p className="pulse-clean-readiness__card-label">{card.level || 'Insight'}</p>
                <h3 className="pulse-clean-readiness__card-title">{card.title}</h3>
                <p className="pulse-clean-readiness__card-body">{card.body}</p>
              </article>
            ))
          ) : (
            <article className="pulse-clean-readiness__card">
              <p className="pulse-clean-readiness__card-label">System</p>
              <h3 className="pulse-clean-readiness__card-title">No readiness alerts returned</h3>
              <p className="pulse-clean-readiness__card-body">
                This timepoint returned no prioritized readiness alerts from the backend.
              </p>
            </article>
          )}
        </div>
        </section>
      ) : null}

      {showScoresSection ? (
        <section className="pulse-clean-scores pulse-sponsorship card">
          <header className="pulse-sponsorship__hero">
            <div>
              <p className="pulse-sponsorship__eyebrow">Sponsorship Analysis · Manager Load Report</p>
              <h3 className="pulse-sponsorship__headline">
                The sponsorship chain is {interventionRequired ? 'not functioning' : 'mostly functioning'}.
                Managers are absorbing pressure from both directions.
              </h3>
              <p className="pulse-sponsorship__subhead">{sponsorshipExecutiveSignal}</p>
            </div>
            <span className={`pulse-sponsorship__verdict pulse-sponsorship__verdict--${interventionRequired ? 'critical' : 'stable'}`}>
              {sponsorshipVerdict}
            </span>
          </header>

          <section className="pulse-sponsorship__section">
            <div className="pulse-sponsorship__section-head">
              <p className="pulse-sponsorship__section-id">Section 1</p>
              <p className="pulse-sponsorship__section-title">Sponsorship Sub-score Overview</p>
            </div>
            <div className="pulse-sponsorship__score-grid">
              <article className="pulse-sponsorship__score-card">
                <p className="pulse-sponsorship__score-label">Adoption Readiness</p>
                <p className="pulse-sponsorship__score-value">{formatScore(adoptionScore)}</p>
                <p className="pulse-sponsorship__score-meta">/40 points</p>
                <div className="pulse-sponsorship__score-bar">
                  <span style={{ width: `${Math.max(0, Math.min(((adoptionScore || 0) / 40) * 100, 100))}%` }} />
                </div>
                <p className="pulse-sponsorship__score-note">
                  {adoptionScore != null && adoptionScore >= threshold ? 'Above' : 'Below'} threshold
                </p>
              </article>
              <article className="pulse-sponsorship__score-card pulse-sponsorship__score-card--sponsorship">
                <p className="pulse-sponsorship__score-label">Sponsorship Credibility</p>
                <p className="pulse-sponsorship__score-value">{formatScore(sponsorshipScore)}</p>
                <p className="pulse-sponsorship__score-meta">/40 points</p>
                <div className="pulse-sponsorship__score-bar pulse-sponsorship__score-bar--sponsorship">
                  <span style={{ width: `${Math.max(0, Math.min(((sponsorshipScore || 0) / 40) * 100, 100))}%` }} />
                </div>
                <p className="pulse-sponsorship__score-note">
                  {sponsorshipScore != null && sponsorshipScore >= threshold ? 'Above' : 'Below'} threshold
                </p>
              </article>
            </div>
            <p className="pulse-sponsorship__signal-summary">
              Score gap (adoption minus sponsorship): <strong>{sponsorshipGap == null ? '--' : formatDelta(sponsorshipGap)}</strong>
            </p>
            <div className="pulse-sponsorship__signals">
              {sponsorshipSignals?.load?.text ? (
                <p
                  className={`pulse-sponsorship__signal pulse-sponsorship__signal--${
                    sponsorshipSignals.load.variant === 'red' ? 'risk' : 'warn'
                  }`}
                >
                  <strong>Load Signal:</strong> {sponsorshipSignals.load.text}
                </p>
              ) : null}
              {sponsorshipSignals?.subScores?.text ? (
                <p
                  className={`pulse-sponsorship__signal pulse-sponsorship__signal--${
                    sponsorshipSignals.subScores.variant === 'red' ? 'risk' : 'warn'
                  }`}
                >
                  <strong>Sub-score Signal:</strong> {sponsorshipSignals.subScores.text}
                </p>
              ) : null}
              {!sponsorshipSignals?.load?.text && !sponsorshipSignals?.subScores?.text ? (
                <p className="pulse-sponsorship__signal pulse-sponsorship__signal--info">
                  Sponsorship signal set was not returned for this timepoint.
                </p>
              ) : null}
            </div>
          </section>

          <section className="pulse-sponsorship__section">
            <div className="pulse-sponsorship__section-head">
              <p className="pulse-sponsorship__section-id">Section 2</p>
              <p className="pulse-sponsorship__section-title">Manager Load Report</p>
            </div>
            <div className="pulse-sponsorship__load-banner">
              <p className="pulse-sponsorship__load-banner-title">Managers carrying critical load</p>
              <p className="pulse-sponsorship__load-banner-value">{formatPercent(criticalLoadPercent)}</p>
              <p className="pulse-sponsorship__load-banner-meta">
                {managerBreakdownRows.length} manager{managerBreakdownRows.length === 1 ? '' : 's'} in scope
              </p>
            </div>
            <div className="pulse-sponsorship__load-track">
              {managerLoadDistribution.map((item) => (
                <span
                  key={item.band}
                  className={`pulse-sponsorship__load-segment pulse-sponsorship__load-segment--${loadBandClassName(item.band)}`}
                  style={{ flex: Math.max(1, item.count) }}
                />
              ))}
            </div>
            <div className="pulse-sponsorship__load-grid">
              {managerLoadDistribution.map((item) => (
                <article key={item.band} className={`pulse-sponsorship__load-card pulse-sponsorship__load-card--${loadBandClassName(item.band)}`}>
                  <p className="pulse-sponsorship__load-percent">{formatPercent(item.percent)}</p>
                  <p className="pulse-sponsorship__load-name">{item.band}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="pulse-sponsorship__section">
            <div className="pulse-sponsorship__section-head">
              <p className="pulse-sponsorship__section-id">Section 3</p>
              <p className="pulse-sponsorship__section-title">Sponsorship Chain States</p>
            </div>
            <div className="pulse-sponsorship__chain-grid">
              {chainStatusDistribution.map((item) => (
                <article key={item.status} className={`pulse-sponsorship__chain-card pulse-sponsorship__chain-card--${loadBandClassName(item.status)}`}>
                  <p className="pulse-sponsorship__chain-percent">{formatPercent(item.percent)}</p>
                  <p className="pulse-sponsorship__chain-name">{item.status}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="pulse-sponsorship__section">
            <div className="pulse-sponsorship__section-head">
              <p className="pulse-sponsorship__section-id">Section 4</p>
              <p className="pulse-sponsorship__section-title">Load Band × Chain Status</p>
            </div>
            <div className="table-wrap">
              <table className="pulse-sponsorship__matrix">
                <thead>
                  <tr>
                    <th>Load Band</th>
                    {loadByChainMatrix.statuses.map((status) => (
                      <th key={`status-col-${status}`}>{status}</th>
                    ))}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {loadByChainMatrix.rows.map((row) => (
                    <tr key={row.band}>
                      <td className="pulse-sponsorship__matrix-band">{row.band}</td>
                      {loadByChainMatrix.statuses.map((status) => (
                        <td key={`${row.band}-${status}`}>{row.cells[status] || 0}</td>
                      ))}
                      <td>{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      ) : null}

      {showDimensionsSection ? (
        <section className="pulse-clean-dimensions card">
        <div className="pulse-clean-dimensions__left">
          <div className="pulse-clean-dimensions__tabs">
            <button
              type="button"
              className={`pulse-clean-dimensions__tab${activeDimensionTab === 'employee' ? ' is-active' : ''}`}
              onClick={() => setActiveDimensionTab('employee')}
            >
              Employee Dimensions
            </button>
            <button
              type="button"
              className={`pulse-clean-dimensions__tab${activeDimensionTab === 'manager' ? ' is-active' : ''}`}
              onClick={() => setActiveDimensionTab('manager')}
            >
              Manager Dimensions
            </button>
          </div>

          <div className="table-wrap">
            <table className="pulse-clean-dimensions__table">
              <thead>
                <tr>
                  <th>Dimension</th>
                  <th>Avg</th>
                  <th>% High</th>
                </tr>
              </thead>
              <tbody>
                {activeDimensionRows.map((dimension) => (
                  <tr key={`${activeDimensionTab}-${dimension.id}`}>
                    <td>{dimension.label}</td>
                    <td>
                      <span className={`pulse-clean-dimensions__heat pulse-clean-dimensions__heat--${heatTone(dimension.avg)}`}>
                        {formatScore(dimension.avg)}
                      </span>
                    </td>
                    <td>{formatPercent(dimension.highPercent)}</td>
                  </tr>
                ))}
                {activeDimensionRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">No dimension data available yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="pulse-clean-dimensions__right">
          <section className="pulse-clean-trend">
            <div className="pulse-clean-trend__head">
              <p className="pulse-clean-trend__title">Trend</p>
              <p className="pulse-clean-trend__meta">Rolling 4 waves</p>
            </div>
            <div className="pulse-clean-trend__bars">
              {trendBars.map((item, index) => {
                const adoptionHeight = Math.max(10, ((item?.adoptionScore || 0) / trendMax) * 100);
                const sponsorshipHeight = Math.max(10, ((item?.sponsorshipScore || 0) / trendMax) * 100);
                return (
                  <div key={item.weekLabel || index} className="pulse-clean-trend__group">
                    <div className="pulse-clean-trend__columns">
                      <span className="pulse-clean-trend__bar pulse-clean-trend__bar--adoption" style={{ height: `${adoptionHeight}%` }} />
                      <span className="pulse-clean-trend__bar pulse-clean-trend__bar--sponsorship" style={{ height: `${sponsorshipHeight}%` }} />
                    </div>
                    <p className="pulse-clean-trend__label">W{index + 1}</p>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="pulse-clean-alerts">
            <p className="pulse-clean-alerts__title">System Alerts</p>
            {(dashboard?.alerts || []).slice(0, 3).map((alert) => (
              <article key={`system-${alert.title}`} className={`pulse-clean-alerts__item pulse-clean-alerts__item--${alert.level || 'info'}`}>
                <p className="pulse-clean-alerts__item-title">{alert.title}</p>
                <p className="pulse-clean-alerts__item-body">{alert.body}</p>
              </article>
            ))}
            {(dashboard?.alerts || []).length === 0 ? (
              <article className="pulse-clean-alerts__item pulse-clean-alerts__item--info">
                <p className="pulse-clean-alerts__item-title">No active alerts</p>
                <p className="pulse-clean-alerts__item-body">
                  Alerts will appear here when thresholds indicate elevated delivery risk.
                </p>
              </article>
            ) : null}
          </section>
        </div>
        </section>
      ) : null}

      {showTeamLevelSection ? (
        <section className="pulse-clean-groups card">
        <div className="pulse-clean-groups__head">
          <h3 style={{ margin: 0 }}>Team-Level Breakdown</h3>
          <p className="pulse-clean-groups__meta">
            {groupLevelLabels.length > 0 ? groupLevelLabels.join(' > ') : 'Group hierarchy'}
          </p>
        </div>
        <div className="table-wrap" style={{ marginTop: '0.6rem' }}>
          <table className="pulse-clean-groups__table">
            <thead>
              <tr>
                <th>Group</th>
                <th>Responses</th>
                <th>Adoption</th>
                <th>Sponsorship</th>
                <th>Manager Load</th>
                <th>Quadrant</th>
                <th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {groupedTeamRows.map((row) => (
                <tr key={row.key}>
                  <td className="pulse-clean-groups__name">
                    {`${row.depth > 0 ? `${'- '.repeat(row.depth)}` : ''}${row.name}`}
                  </td>
                  <td>{row.responses || 0}</td>
                  <td>{formatScore(row.adoption)}</td>
                  <td>{formatScore(row.sponsorship)}</td>
                  <td>{row.loadBand}</td>
                  <td>{row.quadrant}</td>
                  <td>
                    <div className="pulse-clean-groups__spark">
                      {(row.trend || []).map((value, idx) => (
                        <span
                          key={`${row.key}-spark-${idx}`}
                          style={{ height: `${Math.max(3, Math.min(18, ((value || 0) / 40) * 18))}px` }}
                        />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {groupedTeamRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    No grouped team data available yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="pulse-clean-groups__footnote">
          Nested groups are shown with a leading <strong>-</strong> so sub-groups stay visibly linked to their parent group.
        </p>
        </section>
      ) : null}

      {showReportsSection ? (
        <section className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
            <h3 style={{ margin: 0 }}>Past Reports</h3>
            <button type="button" className="btn btn-primary" onClick={() => setReportModalOpen(true)}>
              Generate Report
            </button>
          </div>
          {reportsError ? <p className="error" style={{ marginTop: '1rem' }}>{reportsError}</p> : null}
          {reportsLoading ? <p className="muted" style={{ marginTop: '1rem' }}>Loading reports...</p> : null}
          {!reportsLoading && reports.length === 0 ? (
            <p className="muted" style={{ marginTop: '1rem' }}>No reports generated yet.</p>
          ) : null}
          {!reportsLoading && reports.length > 0 ? (
            <div className="table-wrap" style={{ marginTop: '1rem' }}>
              <table className="admin-table platform-client-dashboard__tasks-table">
                <thead>
                  <tr>
                    <th scope="col">Generated</th>
                    <th scope="col">Stage</th>
                    <th scope="col">Format</th>
                    <th scope="col">Responses</th>
                    <th scope="col">Generated by</th>
                    <th scope="col">Expires</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => (
                    <tr key={report.id}>
                      <td className="muted">
                        {new Date(report.generated_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>
                      <td>{formatReportStage(report.stage)}</td>
                      <td className="pulse-prototype-mono">{String(report.format || '').toUpperCase()}</td>
                      <td>{report.response_count || 0}</td>
                      <td className="muted">{formatReportAuthor(report.generated_by)}</td>
                      <td className="muted">
                        {new Date(report.expires_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => downloadPastReport(report.id)}
                          disabled={report.status !== 'complete'}
                        >
                          Download
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      <ReportGeneratorModal
        open={reportModalOpen}
        onClose={() => {
          setReportModalOpen(false);
          loadReports();
        }}
        organization={org}
      />

    </>
  );
}
