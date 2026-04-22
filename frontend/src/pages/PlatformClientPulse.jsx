import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useOutletContext } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import api from '../services/api.js';
import { normalizeServices } from './platformClientUtils.js';
import { resolvePulseFocusedSection } from './pulseNavigationRules.js';
import ReportGeneratorModal from '../components/platform/ReportGeneratorModal.jsx';

function formatScore(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(1);
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '0%';
  return `${Math.round(value)}%`;
}

function deltaText(value) {
  if (value == null || Number.isNaN(value)) return 'No prior';
  if (value > 0) return `+${value.toFixed(1)}`;
  if (value < 0) return `${value.toFixed(1)}`;
  return '0.0';
}

function deltaClass(value) {
  if (value == null || Number.isNaN(value) || value === 0) return 'flat';
  return value > 0 ? 'up' : 'dn';
}

function heatClass(value) {
  if (value == null || Number.isNaN(value)) return 'h1';
  if (value >= 4.0) return 'h5';
  if (value >= 3.5) return 'h4';
  if (value >= 3.0) return 'h3';
  if (value >= 2.5) return 'h2';
  return 'h1';
}

function labelToId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatPulseTimepointLabel(timepoint, duringDate, duringCheckpointCount = 0) {
  if (timepoint === 'pre') return 'Pre';
  if (timepoint === 'completed') return 'Post';
  if (timepoint === 'during') {
    if (duringCheckpointCount <= 1 || !duringDate) return 'During';
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
  return stage || '—';
}

function formatReportAuthor(author) {
  if (!author) return 'Unknown';
  const full = [author.first_name, author.last_name].filter(Boolean).join(' ').trim();
  return full || author.email || 'Unknown';
}

const QUADRANT_ORDER = [
  'Motivated but Lost',
  'Optimal',
  'High Risk',
  'Capable but Wary',
];

const ADOPTION_DIMENSIONS = ['1A', '1B', '1C', '1D'];
const PULSE_DASHBOARD_RETRY_DELAYS_MS = [500, 1200, 2500, 4500];

function sparkColor(loadBand) {
  if (loadBand === 'Sustainable') return 'var(--pulse-green)';
  if (loadBand === 'Overloaded') return 'var(--pulse-red)';
  if (loadBand === 'At Capacity') return 'var(--pulse-orange)';
  return 'var(--pulse-amber)';
}

function quadrantPillClass(name) {
  if (name === 'Optimal') return 'opt';
  if (name === 'Capable but Wary') return 'cw';
  if (name === 'Motivated but Lost') return 'ml';
  return 'hr';
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
    pulseTimepointOptions,
    trendAnalysisVisible,
  } = useOutletContext();
  const location = useLocation();

  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('employee');
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsError, setReportsError] = useState('');
  const loadRequestIdRef = useRef(0);

  const enabledServices = normalizeServices(org.settings);
  const pulseEnabled = enabledServices.includes('pulse');

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
    if (selectedManagerIds.length > 0) {
      params.managerIds = selectedManagerIds.join(',');
      params.includeManagerSelf = includeManagerSelf ? 'true' : 'false';
    }
    try {
      const { response, attempts } = await fetchPulseDashboardWithRetry(orgId, params);
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
      if (attempts > 1) {
        setError('');
      }
    } catch (failure) {
      if (requestId !== loadRequestIdRef.current) return;
      const cause = failure?.originalError || failure;
      const attempts = Number(failure?.retryAttempts || 1);
      setError(pulseDashboardErrorText(cause, attempts));
      // Keep the last successful dashboard visible if we have one.
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [
    orgId,
    selectedManagerIds,
    includeManagerSelf,
    pulseTimepoint,
    pulseDuringDate,
    setPulseManagerOptions,
    setPulseSelectedManagerIds,
  ]);

  useEffect(() => {
    if (!pulseEnabled) return;
    loadDashboard();
  }, [orgId, pulseEnabled, loadDashboard]);

  const loadReports = useCallback(async () => {
    if (!pulseEnabled) {
      setReports([]);
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
    } catch (e) {
      setReports([]);
      setReportsError(e?.response?.data?.error || 'Could not load report history.');
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

  const pulseFocusedSection = useMemo(() => {
    return resolvePulseFocusedSection(location.hash, trendAnalysisVisible);
  }, [location.hash, trendAnalysisVisible]);

  const pulseDocumentSectionLabel = useMemo(() => {
    const s = pulseFocusedSection;
    if (s === 'organisation-scores') return 'Organisation scores';
    if (s === 'trend-analysis') return 'Trend analysis';
    if (s === 'employee-breakdown') return 'Employee breakdown';
    if (s === 'team-level-view') return 'Team-level view';
    if (s === 'reports') return 'Reports';
    return 'Organisation dashboard';
  }, [pulseFocusedSection]);

  useEffect(() => {
    const previous = document.title;
    const client = String(org?.name ?? '').trim() || 'Client';
    document.title = `Rhythm Engine · ${pulseDocumentSectionLabel} | ${client}`;
    return () => {
      document.title = previous;
    };
  }, [pulseDocumentSectionLabel, org?.name]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    const main = document.querySelector('.pulse-prototype-content');
    if (main && typeof main.scrollTop === 'number') main.scrollTop = 0;
  }, [pulseFocusedSection]);

  const kpis = dashboard?.kpis || {};
  const scoreSemantics = dashboard?.scoreSemantics || {};
  const coverage = dashboard?.coverage || {};
  const trendBars = useMemo(
    () => [...(dashboard?.trend || []).slice(0, 4)].reverse(),
    [dashboard?.trend]
  );
  const quadrants = useMemo(() => {
    const source = dashboard?.quadrants || [];
    return QUADRANT_ORDER.map((name) => source.find((q) => q.name === name) || { name, percent: 0 });
  }, [dashboard?.quadrants]);
  const dimensions = dashboard?.dimensions || [];
  const threshold = scoreSemantics.threshold ?? 28;
  const adoptionScore = kpis.adoptionScore ?? null;
  const sponsorshipScore = kpis.sponsorshipScore ?? null;
  const quadrantFocus =
    quadrants.reduce((top, item) => (item.percent > top.percent ? item : top), quadrants[0] || { name: '—', percent: 0 }) || {
      name: '—',
      percent: 0,
    };

  const todayLabel = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const trendMax = Math.max(
    40,
    ...trendBars.flatMap((item) => [item?.adoptionScore || 0, item?.sponsorshipScore || 0])
  );

  const employeeDimensionRows = dimensions.map((d) => ({
    id: d.id,
    label: d.label,
    family: ADOPTION_DIMENSIONS.includes(d.id) ? 'a' : 's',
    avg: d.energyAvg,
    highPercent: d.highEnergyPercent,
  }));
  const managerDimensionRows = dimensions.map((d) => ({
    id: d.id,
    label: d.managerLabel || d.label,
    family: ADOPTION_DIMENSIONS.includes(d.id) ? 'a' : 's',
    avg: d.frictionAvg,
    highPercent: d.managerHighPercent ?? d.highEnergyPercent,
  }));
  const activeDimensions = activeTab === 'employee' ? employeeDimensionRows : managerDimensionRows;
  const managerBreakdownRows = dashboard?.byManager || [];
  const managerLoadDistribution = useMemo(() => {
    const total = managerBreakdownRows.length;
    const bands = [
      { name: 'Sustainable', className: 'sustainable' },
      { name: 'Stretched', className: 'stretched' },
      { name: 'At Capacity', className: 'at-capacity' },
      { name: 'Overloaded', className: 'overloaded' },
    ];
    return bands.map((band) => {
      const count = managerBreakdownRows.filter((row) => String(row?.managerLoadBand || '').trim() === band.name).length;
      const percent = total > 0 ? (count / total) * 100 : 0;
      return { ...band, count, percent };
    });
  }, [managerBreakdownRows]);

  const showSection = (sectionId) => pulseFocusedSection == null || pulseFocusedSection === sectionId;

  const pageTitle =
    pulseFocusedSection === 'organisation-scores'
      ? 'Organisation Scores'
      : pulseFocusedSection === 'trend-analysis'
        ? 'Trend Analysis'
        : pulseFocusedSection === 'employee-breakdown'
          ? 'Employee Breakdown'
          : pulseFocusedSection === 'team-level-view'
            ? 'Team-Level View'
            : pulseFocusedSection === 'reports'
              ? 'Reports'
            : 'Organisation Dashboard';
  const duringCheckpointCount = useMemo(
    () => (Array.isArray(pulseTimepointOptions)
      ? pulseTimepointOptions.filter((option) => option.phase === 'during').length
      : 0),
    [pulseTimepointOptions]
  );
  const selectedTimepointLabel = formatPulseTimepointLabel(
    pulseTimepoint,
    pulseDuringDate,
    duringCheckpointCount
  );

  return (
    <div className="pulse-prototype-page">
      <div className="pulse-platform-header">
        <div>
          <div className="pulse-platform-header__eyebrow">Client administration</div>
          <h1 className="pulse-platform-header__title">{pageTitle}</h1>
          <div className="pulse-platform-header__timepoint" aria-label={`Point in time ${selectedTimepointLabel}`}>
            {selectedTimepointLabel}
          </div>
        </div>
        <div className="pulse-platform-header__right" style={{ gap: '0.6rem', alignItems: 'center' }}>
          <span className="pulse-platform-header__date">{todayLabel}</span>
          <button
            type="button"
            className="btn btn-ghost pulse-refresh-btn"
            onClick={loadDashboard}
            disabled={loading}
            aria-label={loading ? 'Refreshing dashboard' : 'Refresh dashboard'}
            title={loading ? 'Refreshing dashboard' : 'Refresh dashboard'}
          >
            <RefreshCw
              size={16}
              strokeWidth={1.85}
              aria-hidden
              className={loading ? 'pulse-refresh-btn__icon pulse-refresh-btn__icon--spinning' : 'pulse-refresh-btn__icon'}
            />
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!error && loading && <p className="muted">Loading Rhythm Engine dashboard…</p>}

      <div className="pulse-prototype-content">

          {showSection('organisation-dashboard') && (
          <div className="pulse-prototype-kpis" id="organisation-dashboard">
            <div className="pulse-prototype-kpi">
              <div className="pulse-prototype-kpi__label">Total Responses</div>
              <div className="pulse-prototype-kpi__value neutral">{kpis.completedTotal ?? 0}</div>
              <div className="pulse-prototype-kpi__meta">of {kpis.invitedTotal ?? 0} invited</div>
              <div className={`pulse-prototype-kpi__delta ${deltaClass(kpis.participationRate)}`}>
                {formatPercent(kpis.participationRate)}
              </div>
              <div className="pulse-prototype-kpi__bar" />
            </div>
            <div className="pulse-prototype-kpi">
              <div className="pulse-prototype-kpi__label">Employee Responses</div>
              <div className="pulse-prototype-kpi__value neutral">{kpis.completedEmployees ?? 0}</div>
              <div className="pulse-prototype-kpi__meta">
                of {kpis.invitedEmployees ?? 0} · {formatPercent(kpis.employeeParticipationRate)}
              </div>
              <div className="pulse-prototype-kpi__bar adoption" />
            </div>
            <div className="pulse-prototype-kpi">
              <div className="pulse-prototype-kpi__label">Manager Responses</div>
              <div className="pulse-prototype-kpi__value neutral">{kpis.completedManagers ?? 0}</div>
              <div className="pulse-prototype-kpi__meta">
                of {kpis.invitedManagers ?? 0} · {formatPercent(kpis.managerParticipationRate)}
              </div>
              <div className="pulse-prototype-kpi__bar sponsorship" />
            </div>
            <div className="pulse-prototype-kpi">
              <div className="pulse-prototype-kpi__label">Avg Adoption Score</div>
              <div className="pulse-prototype-kpi__value adoption">{formatScore(adoptionScore)}</div>
              <div className="pulse-prototype-kpi__meta">/40 · Threshold: {threshold}</div>
              <div className={`pulse-prototype-kpi__delta ${deltaClass(kpis.adoptionDelta)}`}>
                {deltaText(kpis.adoptionDelta)}
              </div>
              <div className="pulse-prototype-kpi__bar adoption" />
            </div>
            <div className="pulse-prototype-kpi">
              <div className="pulse-prototype-kpi__label">Avg Sponsorship Score</div>
              <div className="pulse-prototype-kpi__value sponsorship">{formatScore(sponsorshipScore)}</div>
              <div className="pulse-prototype-kpi__meta">
                /40 · {sponsorshipScore != null && sponsorshipScore >= threshold ? 'At threshold' : 'Below threshold'}
              </div>
              <div className={`pulse-prototype-kpi__delta ${deltaClass(kpis.sponsorshipDelta)}`}>
                {deltaText(kpis.sponsorshipDelta)}
              </div>
              <div className="pulse-prototype-kpi__bar sponsorship" />
            </div>
          </div>
          )}

          {showSection('organisation-scores') && (
          <div className="pulse-prototype-grid pulse-prototype-grid--scores" id="organisation-scores">
            <section className="pulse-prototype-card">
              <div className="pulse-prototype-card__label">
                Organisation Scores ·
                {scoreSemantics.averaging === 'pooled_completed_respondents'
                  ? ' Pooled Completed Respondents'
                  : ' All Respondents'}
              </div>
              <div className="pulse-prototype-score-split">
                <div>
                  <div className="pulse-prototype-score-tag adoption">Adoption Readiness</div>
                  <div className="pulse-prototype-score-value adoption">{formatScore(adoptionScore)}</div>
                  <div className="pulse-prototype-score-denom">/40 points</div>
                  <div className="pulse-prototype-track">
                    <div
                      className="pulse-prototype-fill adoption"
                      style={{ width: `${Math.max(0, Math.min(((adoptionScore || 0) / 40) * 100, 100))}%` }}
                    />
                  </div>
                  <span className={`pulse-prototype-pill ${adoptionScore != null && adoptionScore >= threshold ? 'high' : 'low'}`}>
                    {adoptionScore != null && adoptionScore >= threshold ? 'Above Threshold' : 'Below Threshold'}
                  </span>
                </div>
                <div className="pulse-prototype-divider" />
                <div>
                  <div className="pulse-prototype-score-tag sponsorship">Sponsorship Credibility</div>
                  <div className="pulse-prototype-score-value sponsorship">{formatScore(sponsorshipScore)}</div>
                  <div className="pulse-prototype-score-denom">/40 points</div>
                  <div className="pulse-prototype-track">
                    <div
                      className="pulse-prototype-fill sponsorship"
                      style={{ width: `${Math.max(0, Math.min(((sponsorshipScore || 0) / 40) * 100, 100))}%` }}
                    />
                  </div>
                  <span
                    className={`pulse-prototype-pill ${
                      sponsorshipScore != null && sponsorshipScore >= threshold ? 'high' : 'low'
                    }`}
                  >
                    {sponsorshipScore != null && sponsorshipScore >= threshold ? 'Above Threshold' : 'Below Threshold'}
                  </span>
                </div>
              </div>
              <div className="pulse-prototype-note">
                <div className="pulse-prototype-note__title">
                  <span
                    className={`pulse-prototype-verdict-badge ${
                      kpis.launchVerdict === 'cleared'
                        ? 'pulse-prototype-verdict-badge--cleared'
                        : kpis.launchVerdict === 'not_cleared'
                          ? 'pulse-prototype-verdict-badge--not-cleared'
                          : 'pulse-prototype-verdict-badge--unknown'
                    }`}
                  >
                    {kpis.launchHeadline || 'Launch verdict unavailable'}
                  </span>
                  {' · '}
                  {quadrantFocus.name}
                </div>
                <p>
                  {dashboard?.narrative || dashboard?.soWhat || 'AI summary currently unavailable for this client.'}
                </p>
                {dashboard?.soWhatStatus === 'unavailable' ? (
                  <p className="muted" style={{ marginTop: '0.45rem' }}>
                    Check `ANTHROPIC_API_KEY` and Claude API connectivity on the backend deployment.
                  </p>
                ) : null}
                <p className="muted" style={{ marginTop: '0.45rem' }}>
                  Delta baseline: previous 7-day window. Threshold: {scoreSemantics.threshold ?? 28}.
                </p>
              </div>
            </section>

            <section className="pulse-prototype-card">
              <div className="pulse-prototype-card__label">Readiness Distribution · % of respondents</div>
              <div className="pulse-prototype-quadrants">
                {quadrants.map((q) => (
                  <div
                    key={q.name}
                    className={`pulse-prototype-quadrant ${quadrantPillClass(q.name)}`}
                    id={`quad-${labelToId(q.name)}`}
                  >
                    <div className="pulse-prototype-quadrant__pct">{formatPercent(q.percent)}</div>
                    <div className="pulse-prototype-quadrant__name">{q.name}</div>
                  </div>
                ))}
              </div>
              <div className="pulse-prototype-axis">
                <span>&larr; Low Sponsorship</span>
                <span>High Sponsorship &rarr;</span>
              </div>
              <div className="pulse-prototype-axis-up">↑ High Adoption</div>
              {(() => {
                const optimalPct = quadrants.find((q) => q.name === 'Optimal')?.percent ?? 0;
                const nonOptimalPct = 100 - optimalPct;
                if (optimalPct >= 95) {
                  return (
                    <p className="pulse-prototype-readiness-statement pulse-prototype-readiness-statement--positive">
                      {optimalPct}% of respondents are in a position to absorb and sustain this change without additional intervention.
                    </p>
                  );
                }
                return (
                  <p className="pulse-prototype-readiness-statement">
                    Only {optimalPct}% of respondents are in a position to absorb and sustain this change without
                    additional intervention. The remaining {nonOptimalPct}% are distributed across three readiness
                    states — each carrying a distinct failure mode, and none of which offset the others.
                  </p>
                );
              })()}
            </section>
          </div>
          )}

          {showSection('trend-analysis') && trendAnalysisVisible ? (
          <section className="pulse-prototype-card" id="trend-analysis">
            <div className="pulse-prototype-card__label">Trend Analysis · Rolling 4 Waves</div>
            <div className="pulse-prototype-trend-chart">
              <div className="pulse-prototype-trend-threshold">
                <span>{threshold} (threshold)</span>
              </div>
              {trendBars.map((item, idx) => {
                const adoptionHeight = Math.max(6, ((item?.adoptionScore || 0) / trendMax) * 100);
                const sponsorshipHeight = Math.max(6, ((item?.sponsorshipScore || 0) / trendMax) * 100);
                return (
                  <div key={item.weekLabel || idx} className="pulse-prototype-trend-group">
                    <div className="pulse-prototype-trend-bars">
                      <div className="pulse-prototype-trend-bar adoption" style={{ height: `${adoptionHeight}%` }} />
                      <div className="pulse-prototype-trend-bar sponsorship" style={{ height: `${sponsorshipHeight}%` }} />
                    </div>
                    <div className="pulse-prototype-trend-label">W{idx + 1}</div>
                  </div>
                );
              })}
            </div>
            <div className="pulse-prototype-legend">
              <div className="pulse-prototype-legend-item">
                <span className="pulse-prototype-legend-dot adoption" />
                Adoption
              </div>
              <div className="pulse-prototype-legend-item">
                <span className="pulse-prototype-legend-dot sponsorship" />
                Sponsorship
              </div>
            </div>
            {!trendBars.length ? (
              <p className="muted" style={{ marginTop: '0.65rem' }}>
                Trend data will appear after enough completed responses are available.
              </p>
            ) : null}
            <div style={{ marginTop: '1rem' }}>
              <div className="pulse-prototype-card__label">Manager load profile</div>
              <div className="pulse-prototype-load-bar">
                {managerLoadDistribution.map((band) => (
                  <span
                    key={band.name}
                    className={`pulse-prototype-load-segment ${band.className}`}
                    style={{ flex: Math.max(1, band.count || 0) }}
                  />
                ))}
              </div>
              <div className="pulse-prototype-load-grid">
                {managerLoadDistribution.map((band) => (
                  <div key={band.name} className={`pulse-prototype-load-cell ${band.className}`}>
                    <div className="pulse-prototype-load-cell__pct">{formatPercent(band.percent)}</div>
                    <div className="pulse-prototype-load-cell__name">{band.name}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
          ) : null}

          {showSection('employee-breakdown') && (
          <div className="pulse-prototype-grid pulse-prototype-grid--analysis" id="employee-breakdown">
            <section className="pulse-prototype-card">
              <div className="pulse-prototype-tabs">
                <button
                  type="button"
                  className={`pulse-prototype-tab ${activeTab === 'employee' ? 'active' : ''}`}
                  onClick={() => setActiveTab('employee')}
                >
                  Employee Dimensions
                </button>
                <button
                  type="button"
                  className={`pulse-prototype-tab ${activeTab === 'manager' ? 'active' : ''}`}
                  onClick={() => setActiveTab('manager')}
                >
                  Manager Dimensions
                </button>
              </div>
              <table className="pulse-prototype-dtable">
                <thead>
                  <tr>
                    <th>Dimension</th>
                    <th>Avg (1-5)</th>
                    <th>% High</th>
                  </tr>
                </thead>
                <tbody>
                  {activeDimensions.map((d) => (
                    <tr key={`${activeTab}-${d.id}`}>
                      <td>
                        <span className="pulse-prototype-dname">{d.label}</span>
                        <span className={`pulse-prototype-dtag ${d.family}`}>
                          {d.family === 'a' ? 'Adoption' : 'Sponsorship'}
                        </span>
                      </td>
                      <td>
                        <span className={`pulse-prototype-heat ${heatClass(d.avg)}`}>{formatScore(d.avg)}</span>
                      </td>
                      <td className="pulse-prototype-dpct">{formatPercent(d.highPercent)}</td>
                    </tr>
                  ))}
                  {!activeDimensions.length && (
                    <tr>
                      <td colSpan={3} className="pulse-prototype-empty">
                        No dimension data yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            <div className="pulse-prototype-side-stack">
              <section className="pulse-prototype-card">
                <div className="pulse-prototype-card__label">System Alerts</div>
                <div className="pulse-prototype-alerts">
                  {(dashboard?.alerts || []).map((alert) => (
                    <div key={alert.title} className={`pulse-prototype-alert ${alert.level || 'info'}`}>
                      <div className="pulse-prototype-alert-title">{alert.title}</div>
                      <div className="pulse-prototype-alert-body">{alert.body}</div>
                    </div>
                  ))}
                </div>
                {(dashboard?.alertsOverflowCount || 0) > 0 ? (
                  <p className="muted" style={{ marginTop: '0.6rem' }}>
                    +{dashboard.alertsOverflowCount} additional alert
                    {dashboard.alertsOverflowCount === 1 ? '' : 's'} not shown.
                  </p>
                ) : null}
              </section>
            </div>
          </div>
          )}

          {showSection('team-level-view') && (
          <section className="pulse-prototype-card" id="team-level-view">
            <div className="pulse-prototype-card__label">
              Manager-Level Breakdown · {managerBreakdownRows.length} manager
              {managerBreakdownRows.length === 1 ? '' : 's'}
            </div>
            <p className="muted" style={{ marginBottom: '0.6rem' }}>
              Manager assignment coverage: {formatPercent(coverage.employeeManagerAssignmentCoveragePercent)} ·
              Missing assignments: {coverage.employeeRowsMissingManagerAssignment ?? 0}
            </p>
            <p className="muted" style={{ marginBottom: '0.8rem' }}>
              Comparable teams (n&gt;=5): {coverage.managersWithComparableTeamSize ?? 0} · Suppressed:
              {' '}
              {coverage.teamSuppressedManagerCount ?? 0}
            </p>
            <table className="pulse-prototype-rtable">
              <thead>
                <tr>
                  <th>Manager</th>
                  <th>Direct Reports (Invited)</th>
                  <th>Direct Reports (Completed)</th>
                  <th>Adoption</th>
                  <th>Sponsorship</th>
                  <th>Manager Load</th>
                  <th>Quadrant</th>
                  <th>4-Wk Trend</th>
                </tr>
              </thead>
              <tbody>
                {managerBreakdownRows.map((row) => (
                  <tr key={row.managerId}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{row.managerName || row.managerEmail || '—'}</div>
                      <div className="muted pulse-prototype-mono" style={{ fontSize: '0.82rem' }}>
                        {row.managerEmail || '—'}
                      </div>
                    </td>
                    <td className="pulse-prototype-mono">{row.directReportInvitedCount ?? 0}</td>
                    <td className="pulse-prototype-mono">{row.directReportCompletedCount ?? 0}</td>
                    <td>
                      <span className={`pulse-prototype-heat ${heatClass((row.adoptionScore || 0) / 8)}`}>
                        {formatScore(row.adoptionScore)}
                      </span>
                    </td>
                    <td>
                      <span className={`pulse-prototype-heat ${heatClass((row.sponsorshipScore || 0) / 8)}`}>
                        {formatScore(row.sponsorshipScore)}
                      </span>
                    </td>
                    <td className={`pulse-prototype-mono pulse-prototype-load-${labelToId(row.managerLoadBand || '')}`}>
                      {row.managerLoadBand || '—'}
                    </td>
                    <td>
                      {row.quadrant ? (
                        <span className={`pulse-prototype-qpill ${quadrantPillClass(row.quadrant)}`}>
                          {row.quadrant}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <div className="pulse-prototype-spark">
                        {(row.trend || []).map((item, idx) => {
                          const value = item?.adoptionScore ?? 0;
                          return (
                          <span
                            key={`${row.managerId}-spark-${idx}`}
                            style={{
                              height: `${Math.max(3, (value / 35) * 18)}px`,
                              backgroundColor: sparkColor(row.managerLoadBand),
                            }}
                          />
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
                {managerBreakdownRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="muted" style={{ padding: '1rem' }}>
                      No manager breakdown available yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>
          )}

          {pulseFocusedSection === 'reports' && (
          <section className="pulse-prototype-card" id="reports">
            <div className="pulse-prototype-card__label">Reports</div>
            <p className="muted" style={{ marginBottom: '0.8rem' }}>
              Generate a report for this point in time and selected filters.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setReportModalOpen(true)}
            >
              Generate Report
            </button>
            {reportsError ? <p className="error" style={{ marginTop: '1rem' }}>{reportsError}</p> : null}
            {reportsLoading ? <p className="muted" style={{ marginTop: '1rem' }}>Loading reports…</p> : null}
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
          )}
      </div>
      <ReportGeneratorModal
        open={reportModalOpen}
        onClose={() => {
          setReportModalOpen(false);
          loadReports();
        }}
        organization={org}
      />
    </div>
  );
}
