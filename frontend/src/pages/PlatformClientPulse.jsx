import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useOutletContext } from 'react-router-dom';
import api from '../services/api.js';
import { normalizeServices } from './platformClientUtils.js';
import { normalizePulseHash, resolvePulseFocusedSection } from './pulseNavigationRules.js';
import ReportGeneratorModal from '../components/platform/ReportGeneratorModal.jsx';
import PulseTrendAnalysisSection from '../components/platform/PulseTrendAnalysisSection.jsx';
import { crmAppBaseUrl } from '../config/appSurface.js';

const PULSE_DASHBOARD_RETRY_DELAYS_MS = [500, 1200, 2500, 4500];
const QUADRANT_ORDER = ['Motivated but Lost', 'Optimal', 'High Risk', 'Capable but Wary'];
const DIMENSION_ORDER = ['1A', '1B', '1C', '1D', '2A', '2B', '2C', '2D'];
const PERCEPTION_GAP_THRESHOLD = 1.5;
const INTRA_DIMENSION_DIVERGENCE_THRESHOLD = 1.5;
const DIMENSION_COMPARISON_META = {
  '1A': {
    sharedConstruct: 'Does the team have skills to absorb the change?',
    pairing: 'Strong',
    comparable: true,
  },
  '1B': {
    sharedConstruct: 'How has the org handled change historically?',
    pairing: 'Moderate',
    comparable: true,
  },
  '1C': {
    sharedConstruct: 'Different subjects, not directly comparable',
    pairing: 'Excluded',
    comparable: false,
  },
  '1D': {
    sharedConstruct: 'Is the layer above supporting the layer below?',
    pairing: 'Strong',
    comparable: true,
  },
  '2A': {
    sharedConstruct: 'Are senior leaders visibly committed?',
    pairing: 'Moderate',
    comparable: true,
  },
  '2B': {
    sharedConstruct: 'Are leaders modelling the change credibly?',
    pairing: 'Strong',
    comparable: true,
  },
  '2C': {
    sharedConstruct: 'Different constructs, not directly comparable',
    pairing: 'Excluded',
    comparable: false,
  },
  '2D': {
    sharedConstruct: 'Is the environment safe and sustainable?',
    pairing: 'Strong',
    comparable: true,
  },
};

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

function quadrantForScores(adoption, sponsorship, threshold = 28) {
  if (!Number.isFinite(adoption) || !Number.isFinite(sponsorship)) return null;
  const adoptionHigh = adoption >= threshold;
  const sponsorshipHigh = sponsorship >= threshold;
  if (adoptionHigh && sponsorshipHigh) return 'Optimal';
  if (adoptionHigh && !sponsorshipHigh) return 'Motivated but Lost';
  if (!adoptionHigh && sponsorshipHigh) return 'Capable but Wary';
  return 'High Risk';
}

function quadrantLetterForName(name) {
  if (name === 'Motivated but Lost') return 'A';
  if (name === 'Optimal') return 'B';
  if (name === 'High Risk') return 'C';
  if (name === 'Capable but Wary') return 'D';
  return null;
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

function dimensionQuestionLabel(questionIds = [], fallbackPrefix = 'Q', fallbackIndex = 0) {
  return questionIds[fallbackIndex] || `${fallbackPrefix}${fallbackIndex + 1}`;
}

function normalizeThresholdStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized.includes('above')) return 'above';
  return 'below';
}

function thresholdSignalColor(status) {
  return normalizeThresholdStatus(status) === 'above' ? 'var(--pulse-green)' : 'var(--pulse-red)';
}

function loadBandClassName(label) {
  return String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function loadBandDescription(band) {
  if (band === 'Sustainable') return 'Genuine surplus capacity. Ready to lead change actively.';
  if (band === 'Stretched') return 'Managing, but at risk under significant additional load.';
  if (band === 'At Capacity') return 'Requires structured support and executive air cover.';
  if (band === 'Overloaded') return 'Risk amplifier. Do not launch without addressing load first.';
  return '';
}

function loadBandColor(band) {
  if (band === 'Sustainable') return 'var(--pulse-green)';
  if (band === 'Stretched') return 'var(--pulse-amber)';
  if (band === 'At Capacity') return 'var(--pulse-orange)';
  if (band === 'Overloaded') return 'var(--pulse-red)';
  return 'var(--pulse-text)';
}

function loadBandTextClassName(band) {
  const normalized = loadBandClassName(band);
  if (normalized === 'sustainable') return 'pulse-sa-load-text--sustainable';
  if (normalized === 'stretched') return 'pulse-sa-load-text--stretched';
  if (normalized === 'at-capacity') return 'pulse-sa-load-text--at-capacity';
  if (normalized === 'overloaded') return 'pulse-sa-load-text--overloaded';
  return '';
}

function renderSignalMarkup(text) {
  const source = String(text || '').trim();
  if (!source) return null;
  const nodes = [];
  const regex = /<strong>(.*?)<\/strong>/gi;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(source)) != null) {
    if (match.index > lastIndex) {
      nodes.push(source.slice(lastIndex, match.index));
    }
    nodes.push(<strong key={`signal-strong-${match.index}`}>{match[1]}</strong>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < source.length) nodes.push(source.slice(lastIndex));
  return nodes.length > 0 ? nodes : source;
}

function sponsorshipSignalVariantClass(variant) {
  const normalized = String(variant || '').trim().toLowerCase();
  if (normalized === 'red') return 'pulse-sa-signal--red';
  if (normalized === 'orange') return 'pulse-sa-signal--orange';
  return 'pulse-sa-signal--amber';
}

const chainMatrixQuadOrder = [
  {
    status: 'At-Risk Leadership',
    backendName: 'Breaking at Manager Level',
    label: 'Breaking at manager level',
    className: 'cp-bm',
    color: 'var(--pulse-amber)',
    description: 'Senior sponsorship is present. The chain is failing at the manager layer — equip and support before rollout.',
  },
  {
    status: 'Chain Functioning',
    backendName: 'Chain Functioning',
    label: 'Chain functioning',
    className: 'cp-fn',
    color: 'var(--pulse-green)',
    description: 'Both layers adequate. Proceed with standard support structures.',
  },
  {
    status: 'Failed at Both Levels',
    backendName: 'Sponsorship Failed at Both Levels',
    label: 'Failed at both levels',
    className: 'cp-fb',
    color: 'var(--pulse-red)',
    description: 'Critical. Neither senior sponsorship nor manager capacity is adequate. Structural redesign required.',
  },
  {
    status: 'Resilient, Under-supported',
    backendName: 'Managers Resilient, Under-Supported',
    label: 'Managers resilient, under-supported',
    className: 'cp-ru',
    color: 'var(--pulse-orange)',
    description: 'Managers are holding the line without adequate senior backing. This will not sustain under significant load.',
  },
];

function managerChainStatus(quadrant) {
  if (quadrant === 'Optimal') return 'Chain Functioning';
  if (quadrant === 'Motivated but Lost') return 'Resilient, Under-supported';
  if (quadrant === 'Capable but Wary') return 'At-Risk Leadership';
  return 'Failed at Both Levels';
}

function chainStatePillClass(state) {
  const s = String(state || '').trim();
  if (s === 'Chain Functioning') return 'cp-fn';
  if (s === 'Breaking at Manager Level' || s === 'At-Risk Leadership') return 'cp-bm';
  if (s === 'Managers Resilient, Under-Supported' || s === 'Resilient, Under-supported') return 'cp-ru';
  if (s === 'Sponsorship Failed at Both Levels' || s === 'Failed at Both Levels') return 'cp-fb';
  return '';
}

const TREND_STAGE_ORDER = [
  { key: 'pre', timepoint: 'pre', label: 'Pre-Change' },
  { key: 'mid', timepoint: 'during', label: 'During-Change' },
  { key: 'post', timepoint: 'completed', label: 'Post-Change' },
];

function average(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function buildTrendStageSnapshot(stageKey, label, payload) {
  const dimensions = Array.isArray(payload?.dimensions) ? payload.dimensions : [];
  const byId = new Map(dimensions.map((row) => [row.id, row]));
  const employeeDimensions = Object.fromEntries(
    DIMENSION_ORDER.map((id) => [id, Number.isFinite(byId.get(id)?.energyAvg) ? byId.get(id).energyAvg : null])
  );
  const managerDimensions = Object.fromEntries(
    DIMENSION_ORDER.map((id) => [id, Number.isFinite(byId.get(id)?.frictionAvg) ? byId.get(id).frictionAvg : null])
  );
  const loadBands = Array.isArray(payload?.sponsorshipAnalysis?.section2?.bands)
    ? payload.sponsorshipAnalysis.section2.bands
    : [];
  const chainStates = Array.isArray(payload?.sponsorshipAnalysis?.section3?.states)
    ? payload.sponsorshipAnalysis.section3.states
    : [];
  const dominantQuadrant = [...(payload?.quadrants || [])]
    .sort((a, b) => (Number(b?.percent) || 0) - (Number(a?.percent) || 0))[0]?.name || '--';
  const employeeSponsorshipAvg = average([
    employeeDimensions['2A'],
    employeeDimensions['2B'],
    employeeDimensions['2C'],
    employeeDimensions['2D'],
  ]);
  const managerSponsorshipAvg = average([
    managerDimensions['2A'],
    managerDimensions['2B'],
    managerDimensions['2C'],
    managerDimensions['2D'],
  ]);

  return {
    key: stageKey,
    label,
    available: Boolean(payload),
    adoptionScore: Number.isFinite(payload?.kpis?.adoptionScore) ? payload.kpis.adoptionScore : null,
    sponsorshipScore: Number.isFinite(payload?.kpis?.sponsorshipScore) ? payload.kpis.sponsorshipScore : null,
    quadrant: dominantQuadrant,
    receivedAvg: Number.isFinite(payload?.sponsorshipAnalysis?.section1?.received?.avg)
      ? payload.sponsorshipAnalysis.section1.received.avg
      : null,
    capacityAvg: Number.isFinite(payload?.sponsorshipAnalysis?.section1?.capacity?.avg)
      ? payload.sponsorshipAnalysis.section1.capacity.avg
      : null,
    loadBands: {
      Sustainable: Number(loadBands.find((band) => band.name === 'Sustainable')?.percent || 0),
      Stretched: Number(loadBands.find((band) => band.name === 'Stretched')?.percent || 0),
      'At Capacity': Number(loadBands.find((band) => band.name === 'At Capacity')?.percent || 0),
      Overloaded: Number(loadBands.find((band) => band.name === 'Overloaded')?.percent || 0),
    },
    chainStates: {
      'Chain Functioning': Number(chainStates.find((row) => row.name === 'Chain Functioning')?.percent || 0),
      'Breaking at Manager Level': Number(chainStates.find((row) => row.name === 'Breaking at Manager Level')?.percent || 0),
      'Managers Resilient, Under-Supported': Number(chainStates.find((row) => row.name === 'Managers Resilient, Under-Supported')?.percent || 0),
      'Sponsorship Failed at Both Levels': Number(chainStates.find((row) => row.name === 'Sponsorship Failed at Both Levels')?.percent || 0),
    },
    dimensions: {
      employee: employeeDimensions,
      manager: managerDimensions,
    },
    employeeSponsorshipAvg,
    managerSponsorshipAvg,
    perceptionGap: employeeSponsorshipAvg != null && managerSponsorshipAvg != null
      ? managerSponsorshipAvg - employeeSponsorshipAvg
      : null,
  };
}

function buildCrossStageDivergenceFlags(orderedStages, threshold = 1.0) {
  const flags = [];
  const transitions = [];
  for (let idx = 1; idx < orderedStages.length; idx += 1) {
    const from = orderedStages[idx - 1];
    const to = orderedStages[idx];
    if (!from.available || !to.available) continue;
    transitions.push([from, to]);
  }
  transitions.forEach(([from, to]) => {
    DIMENSION_ORDER.forEach((dimensionId) => {
      const employeeFrom = from.dimensions.employee[dimensionId];
      const employeeTo = to.dimensions.employee[dimensionId];
      if (Number.isFinite(employeeFrom) && Number.isFinite(employeeTo)) {
        const delta = employeeTo - employeeFrom;
        if (Math.abs(delta) >= threshold) {
          flags.push({
            key: `employee-${dimensionId}-${from.key}-${to.key}`,
            dimensionId,
            survey: 'Employee',
            transition: `${from.label} -> ${to.label}`,
            from: employeeFrom,
            to: employeeTo,
            delta,
          });
        }
      }
      const managerFrom = from.dimensions.manager[dimensionId];
      const managerTo = to.dimensions.manager[dimensionId];
      if (Number.isFinite(managerFrom) && Number.isFinite(managerTo)) {
        const delta = managerTo - managerFrom;
        if (Math.abs(delta) >= threshold) {
          flags.push({
            key: `manager-${dimensionId}-${from.key}-${to.key}`,
            dimensionId,
            survey: 'Manager',
            transition: `${from.label} -> ${to.label}`,
            from: managerFrom,
            to: managerTo,
            delta,
          });
        }
      }
    });
  });
  return flags.sort((a, b) => {
    const absDiff = Math.abs(b.delta) - Math.abs(a.delta);
    if (absDiff !== 0) return absDiff;
    if (a.delta < 0 && b.delta > 0) return -1;
    if (a.delta > 0 && b.delta < 0) return 1;
    return a.dimensionId.localeCompare(b.dimensionId);
  });
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
  const [groupInviteMap, setGroupInviteMap] = useState({});
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsError, setReportsError] = useState('');
  const [trendSnapshots, setTrendSnapshots] = useState({});
  const [trendSignals, setTrendSignals] = useState({});
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState('');
  const loadRequestIdRef = useRef(0);

  const enabledServices = normalizeServices(org.settings);
  const pulseEnabled = enabledServices.includes('pulse');
  const pulseFocusedSection = useMemo(
    () => resolvePulseFocusedSection(location.hash, trendAnalysisVisible),
    [location.hash, trendAnalysisVisible]
  );
  const normalizedPulseHash = useMemo(() => normalizePulseHash(location.hash), [location.hash]);
  const pageTitle = sectionLabel(pulseFocusedSection);
  const showingFullDashboard = !normalizedPulseHash || normalizedPulseHash === 'organisation-dashboard';
  const showingSponsorshipOnly = !showingFullDashboard && pulseFocusedSection === 'sponsorship-analysis';
  const showTopSummaryCard = showingSponsorshipOnly;
  const managerFocusedTopCard = showingSponsorshipOnly;
  const showReadinessSection = pulseFocusedSection === 'organisation-scores';
  const showScoresSection = pulseFocusedSection === 'sponsorship-analysis';
  const showTrendSection = pulseFocusedSection === 'trend-analysis';
  const showTeamLevelSection = pulseFocusedSection === 'team-level-view';
  const showReportsSection = pulseFocusedSection === 'reports';
  const kpis = dashboard?.kpis || {};
  const scoreSemantics = dashboard?.scoreSemantics || {};
  const quadrants = useMemo(() => {
    const source = dashboard?.quadrants || [];
    return QUADRANT_ORDER.map((name) => source.find((q) => q.name === name) || { name, percent: 0 });
  }, [dashboard?.quadrants]);
  const dominantQuadrant = useMemo(
    () => [...quadrants].sort((a, b) => (Number(b?.percent) || 0) - (Number(a?.percent) || 0))[0] || { name: '--', percent: 0 },
    [quadrants]
  );
  const optimalPercent = quadrants.find((q) => q.name === 'Optimal')?.percent ?? 0;
  const insightCards = (dashboard?.alerts || []).slice(0, 3);
  const sponsorshipSignals = dashboard?.sponsorshipAnalysis?.signals || null;
  const threshold = Number.isFinite(scoreSemantics.threshold) ? scoreSemantics.threshold : 28;
  const adoptionScore = Number.isFinite(kpis.adoptionScore) ? kpis.adoptionScore : null;
  const sponsorshipScore = Number.isFinite(kpis.sponsorshipScore) ? kpis.sponsorshipScore : null;
  const managerBreakdownRows = dashboard?.byManager || [];
  const dimensions = dashboard?.dimensions || [];
  const dimensionHeatmapRows = useMemo(() => {
    const byId = new Map(dimensions.map((row) => [row.id, row]));
    return DIMENSION_ORDER.map((id) => {
      const base = byId.get(id) || {};
      const meta = DIMENSION_COMPARISON_META[id] || {
        sharedConstruct: '',
        pairing: 'Excluded',
        comparable: false,
      };
      const comparable = typeof base.comparable === 'boolean' ? base.comparable : meta.comparable;
      const employeeQuestionIds = Array.isArray(base?.employee?.questionIds)
        ? base.employee.questionIds
        : [];
      const managerQuestionIds = Array.isArray(base?.manager?.questionIds)
        ? base.manager.questionIds
        : [];
      const employeeAvg = Number.isFinite(base?.employee?.average)
        ? base.employee.average
        : (Number.isFinite(base.energyAvg) ? base.energyAvg : null);
      const managerAvg = Number.isFinite(base?.manager?.average)
        ? base.manager.average
        : (Number.isFinite(base.frictionAvg) ? base.frictionAvg : null);
      const employeeQ1Avg = Number.isFinite(base?.employee?.q1Avg) ? base.employee.q1Avg : null;
      const employeeQ2Avg = Number.isFinite(base?.employee?.q2Avg) ? base.employee.q2Avg : null;
      const managerQ1Avg = Number.isFinite(base?.manager?.q1Avg) ? base.manager.q1Avg : null;
      const managerQ2Avg = Number.isFinite(base?.manager?.q2Avg) ? base.manager.q2Avg : null;
      const employeeIntraGap = Number.isFinite(base?.employee?.intraGap)
        ? base.employee.intraGap
        : (Number.isFinite(employeeQ1Avg) && Number.isFinite(employeeQ2Avg)
          ? Math.abs(employeeQ1Avg - employeeQ2Avg)
          : null);
      const managerIntraGap = Number.isFinite(base?.manager?.intraGap)
        ? base.manager.intraGap
        : (Number.isFinite(managerQ1Avg) && Number.isFinite(managerQ2Avg)
          ? Math.abs(managerQ1Avg - managerQ2Avg)
          : null);
      const gap = Number.isFinite(base.perceptionGap)
        ? base.perceptionGap
        : (comparable && employeeAvg != null && managerAvg != null
          ? Math.abs(employeeAvg - managerAvg)
          : null);
      return {
        id,
        employeeLabel: base.label || '--',
        managerLabel: base.managerLabel || '--',
        comparable,
        pairing: meta.pairing,
        sharedConstruct: meta.sharedConstruct,
        employeeQuestionIds,
        managerQuestionIds,
        employee: {
          q1Avg: employeeQ1Avg,
          q2Avg: employeeQ2Avg,
          avg: employeeAvg,
          intraGap: employeeIntraGap,
          intraGapFlagged:
            typeof base?.employee?.intraGapFlagged === 'boolean'
              ? base.employee.intraGapFlagged
              : (employeeIntraGap != null && employeeIntraGap >= INTRA_DIMENSION_DIVERGENCE_THRESHOLD),
        },
        manager: {
          q1Avg: managerQ1Avg,
          q2Avg: managerQ2Avg,
          avg: managerAvg,
          intraGap: managerIntraGap,
          intraGapFlagged:
            typeof base?.manager?.intraGapFlagged === 'boolean'
              ? base.manager.intraGapFlagged
              : (managerIntraGap != null && managerIntraGap >= INTRA_DIMENSION_DIVERGENCE_THRESHOLD),
        },
        gap,
        perceptionGapFlagged:
          typeof base?.perceptionGapFlagged === 'boolean'
            ? base.perceptionGapFlagged
            : (gap != null && gap >= PERCEPTION_GAP_THRESHOLD),
      };
    });
  }, [dimensions]);
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
  const overloadedPercent = managerLoadDistribution.find((item) => item.band === 'Overloaded')?.percent || 0;
  const sponsorshipGap = adoptionScore == null || sponsorshipScore == null
    ? null
    : (adoptionScore - sponsorshipScore);
  const interventionRequired = (sponsorshipScore != null && sponsorshipScore < threshold)
    || overloadedPercent > 10
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

    const createNode = (name, depth = 0, key = 'root', parentKey = null) => ({
      key,
      parentKey,
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
          const parentKey = cursor.depth >= 0 ? cursor.key : null;
          const childKey = `${cursor.key}:${segment}`;
          cursor.children.set(segment, createNode(segment, index, childKey, parentKey));
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
          key: child.key,
          parentKey: child.parentKey,
          depth: child.depth,
          name: child.name,
          hasChildren: child.children.size > 0,
          ...child.aggregate,
        });
        walk(child);
      });
    };
    walk(root);
    return flattened;
  }, [groupInviteMap, managerBreakdownRows]);
  const [expandedGroupKeys, setExpandedGroupKeys] = useState({});
  const visibleGroupedTeamRows = useMemo(() => {
    if (!groupedTeamRows.length) return [];
    const byKey = new Map(groupedTeamRows.map((row) => [row.key, row]));
    return groupedTeamRows.filter((row) => {
      let parentKey = row.parentKey;
      while (parentKey) {
        if (!expandedGroupKeys[parentKey]) return false;
        const parentRow = byKey.get(parentKey);
        parentKey = parentRow?.parentKey || null;
      }
      return true;
    });
  }, [expandedGroupKeys, groupedTeamRows]);

  useEffect(() => {
    setExpandedGroupKeys((prev) => {
      const groupedKeySet = new Set(groupedTeamRows.map((row) => row.key));
      let changed = false;
      const next = {};
      Object.entries(prev).forEach(([key, isExpanded]) => {
        if (isExpanded && groupedKeySet.has(key)) {
          next[key] = true;
        } else if (isExpanded && !groupedKeySet.has(key)) {
          changed = true;
        }
      });
      if (!changed && Object.keys(next).length === Object.keys(prev).length) return prev;
      return next;
    });
  }, [groupedTeamRows]);

  const toggleGroupRow = useCallback((rowKey) => {
    setExpandedGroupKeys((prev) => {
      if (prev[rowKey]) {
        const next = { ...prev };
        delete next[rowKey];
        return next;
      }
      return { ...prev, [rowKey]: true };
    });
  }, []);
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
  const reportDateLabel = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const orderedTrendStages = useMemo(() => {
    const fullOrder = TREND_STAGE_ORDER.map((stage) => {
      const snapshot = trendSnapshots[stage.key];
      return snapshot || {
        key: stage.key,
        label: stage.label,
        available: false,
        adoptionScore: null,
        sponsorshipScore: null,
        quadrant: '--',
        receivedAvg: null,
        capacityAvg: null,
        loadBands: {
          Sustainable: 0,
          Stretched: 0,
          'At Capacity': 0,
          Overloaded: 0,
        },
        chainStates: {
          'Chain Functioning': 0,
          'Breaking at Manager Level': 0,
          'Managers Resilient, Under-Supported': 0,
          'Sponsorship Failed at Both Levels': 0,
        },
        dimensions: {
          employee: Object.fromEntries(DIMENSION_ORDER.map((id) => [id, null])),
          manager: Object.fromEntries(DIMENSION_ORDER.map((id) => [id, null])),
        },
        employeeSponsorshipAvg: null,
        managerSponsorshipAvg: null,
        perceptionGap: null,
      };
    });
    const availableStages = fullOrder.filter((stage) => stage.available);
    return availableStages.length > 0 ? availableStages : fullOrder;
  }, [trendSnapshots]);
  const trendDivergenceFlags = useMemo(
    () => buildCrossStageDivergenceFlags(orderedTrendStages, 1.0),
    [orderedTrendStages]
  );
  const scoreCardSignals = dashboard?.scoreCardSignals || {};
  const adoptionScoreCardSignal = scoreCardSignals.adoption || {};
  const sponsorshipScoreCardSignal = scoreCardSignals.sponsorship || {};
  const likelihoodSignal = dashboard?.likelihoodSignal || {};
  const executiveSummary = dashboard?.executiveSummary || null;
  const executiveSignalText = (dashboard?.soWhat || dashboard?.narrative || '').trim();
  const micDropScenarios = Array.isArray(executiveSummary?.scenarios) ? executiveSummary.scenarios : [];
  const executiveSubhead = String(executiveSummary?.subhead || '').trim();
  const adoptionOverviewBlurb = adoptionScore != null
    ? (adoptionScoreCardSignal.blurb
      || `Average adoption readiness is ${formatScore(adoptionScore)}/40, which is ${adoptionScore >= threshold ? 'above' : 'below'} the ${threshold}/40 threshold for execution readiness.`)
    : 'Adoption readiness score is not available for this timepoint yet.';
  const sponsorshipOverviewBlurb = sponsorshipScore != null
    ? (sponsorshipScoreCardSignal.blurb
      || `Average sponsorship credibility is ${formatScore(sponsorshipScore)}/40, which is ${sponsorshipScore >= threshold ? 'above' : 'below'} the ${threshold}/40 leadership support threshold.`)
    : 'Sponsorship credibility score is not available for this timepoint yet.';
  const adoptionWhyThisMatters = adoptionScoreCardSignal.text
    || adoptionScoreCardSignal.fallback
    || executiveSignalText
    || insightCards[0]?.body
    || 'Use this as a readiness signal for whether people can absorb change at the current pace.';
  const sponsorshipWhyThisMatters = sponsorshipScoreCardSignal.text
    || sponsorshipScoreCardSignal.fallback
    || sponsorshipSignals?.subScores?.text
    || sponsorshipExecutiveSignal
    || executiveSignalText
    || 'Use this to gauge whether managers can actively sponsor change across their teams.';
  const launchStatusLabel = kpis.launchVerdict === 'cleared' ? 'Cleared to Launch' : 'Not Cleared';
  const likelihoodSignalText = String(
    likelihoodSignal.text
    || likelihoodSignal.fallback
    || executiveSubhead
    || executiveSignalText
    || ''
  ).trim();
  const topCardTotalResponses = managerFocusedTopCard ? (kpis.completedManagers ?? 0) : (kpis.completedTotal ?? 0);
  const topCardInvitedTotal = managerFocusedTopCard ? (kpis.invitedManagers ?? 0) : (kpis.invitedTotal ?? 0);
  const topCardParticipationRate = managerFocusedTopCard ? kpis.managerParticipationRate : kpis.participationRate;
  const topCardEmployeeResponses = managerFocusedTopCard ? (kpis.completedManagers ?? 0) : (kpis.completedEmployees ?? 0);
  const topCardInvitedEmployees = managerFocusedTopCard ? (kpis.invitedManagers ?? 0) : (kpis.invitedEmployees ?? 0);
  const topCardManagerResponses = kpis.completedManagers ?? 0;
  const topCardInvitedManagers = kpis.invitedManagers ?? 0;
  const topCardAdoptionScore = kpis.adoptionScore;
  const topCardSponsorshipScore = kpis.sponsorshipScore;
  const topCardAdoptionDelta = kpis.adoptionDelta;
  const topCardSponsorshipDelta = kpis.sponsorshipDelta;
  const topCardQuadrantName = quadrantForScores(topCardAdoptionScore, topCardSponsorshipScore, threshold);
  const topCardQuadrantLetter = quadrantLetterForName(topCardQuadrantName);
  const topCardQuadrantLabel = topCardQuadrantLetter ? `${topCardQuadrantLetter} · ${topCardQuadrantName}` : '--';

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

  const loadTrendAnalysis = useCallback(async () => {
    if (!pulseEnabled || !trendAnalysisVisible) {
      setTrendSnapshots({});
      setTrendSignals({});
      setTrendError('');
      setTrendLoading(false);
      return;
    }
    if (pulseTimepoint === 'pre') {
      setTrendSnapshots({});
      setTrendSignals({});
      setTrendError('');
      setTrendLoading(false);
      return;
    }

    setTrendLoading(true);
    setTrendError('');
    try {
      const sharedParams = {};
      if (selectedManagerIds.length > 0) {
        sharedParams.managerIds = selectedManagerIds.join(',');
        sharedParams.includeManagerSelf = includeManagerSelf ? 'true' : 'false';
      }

      const preParams = { ...sharedParams, timepoint: 'pre' };
      const duringParams = { ...sharedParams, timepoint: 'during' };
      if (pulseTimepoint === 'during' && pulseDuringDate) {
        duringParams.duringDate = pulseDuringDate;
      }
      if (pulseTimepoint === 'during' && pulseDuringSessionId) {
        duringParams.duringSessionId = pulseDuringSessionId;
      }
      const shouldLoadPostStage = pulseTimepoint === 'completed';
      const requests = [
        api.get(`/api/platform/organizations/${orgId}/rhythm-engine-dashboard`, { params: preParams }),
        api.get(`/api/platform/organizations/${orgId}/rhythm-engine-dashboard`, { params: duringParams }),
      ];
      if (shouldLoadPostStage) {
        const postParams = { ...sharedParams, timepoint: 'completed' };
        requests.push(api.get(`/api/platform/organizations/${orgId}/rhythm-engine-dashboard`, { params: postParams }));
      }
      const [preResult, duringResult, postResult] = await Promise.allSettled(requests);

      const snapshotMap = {};
      if (preResult.status === 'fulfilled' && preResult.value?.data) {
        snapshotMap.pre = buildTrendStageSnapshot('pre', 'Pre-Change', preResult.value.data);
      }
      if (duringResult.status === 'fulfilled' && duringResult.value?.data) {
        snapshotMap.mid = buildTrendStageSnapshot('mid', 'During-Change', duringResult.value.data);
      }
      if (postResult?.status === 'fulfilled' && postResult.value?.data) {
        snapshotMap.post = buildTrendStageSnapshot('post', 'Post-Change', postResult.value.data);
      }

      if (Object.keys(snapshotMap).length === 0) {
        throw new Error('No trend data returned');
      }

      let nextSignals = {};
      try {
        const { data } = await api.post(`/api/platform/organizations/${orgId}/pulse-trend-signals`, {
          selectedTimepoint: pulseTimepoint,
          stages: Object.values(snapshotMap),
        });
        if (data?.signals && typeof data.signals === 'object') {
          nextSignals = data.signals;
        }
      } catch {
        nextSignals = {};
      }

      setTrendSnapshots(snapshotMap);
      setTrendSignals(nextSignals);
    } catch {
      setTrendSnapshots({});
      setTrendSignals({});
      setTrendError('Could not load trend analysis data.');
    } finally {
      setTrendLoading(false);
    }
  }, [
    includeManagerSelf,
    orgId,
    pulseDuringDate,
    pulseDuringSessionId,
    pulseTimepoint,
    pulseEnabled,
    selectedManagerIds,
    trendAnalysisVisible,
  ]);

  useEffect(() => {
    loadTrendAnalysis();
  }, [loadTrendAnalysis]);

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
      const base = crmAppBaseUrl();
      const { data } = await api.get(`${base}/api/reports`, {
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
      const base = crmAppBaseUrl();
      const { data } = await api.get(`${base}/api/reports/${reportId}/download-link`);
      const downloadUrl = data?.download_url;
      if (!downloadUrl) throw new Error('Missing download URL');

      const response = await api.get(`${base}${downloadUrl}`, {
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
    <div className="pulse-prototype-page">
      {showTopSummaryCard ? (
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
            <p className="pulse-clean-header__kpi-value">{topCardTotalResponses}</p>
            <p className="pulse-clean-header__kpi-meta">of {topCardInvitedTotal} invited</p>
            <p className={`pulse-clean-header__kpi-delta pulse-clean-header__kpi-delta--${deltaTone(topCardParticipationRate)}`}>
              {formatPercent(topCardParticipationRate)}
            </p>
          </div>
          <div className="pulse-clean-header__kpi">
            <p className="pulse-clean-header__kpi-label">Employee Responses</p>
            <p className="pulse-clean-header__kpi-value">{topCardEmployeeResponses}</p>
            <p className="pulse-clean-header__kpi-meta">of {topCardInvitedEmployees ?? 0}</p>
          </div>
          <div className="pulse-clean-header__kpi">
            <p className="pulse-clean-header__kpi-label">Manager Responses</p>
            <p className="pulse-clean-header__kpi-value">{topCardManagerResponses}</p>
            <p className="pulse-clean-header__kpi-meta">of {topCardInvitedManagers} invited</p>
            <p className={`pulse-clean-header__kpi-delta pulse-clean-header__kpi-delta--${deltaTone(kpis.managerParticipationRate)}`}>
              {formatPercent(kpis.managerParticipationRate)}
            </p>
          </div>
          <div className="pulse-clean-header__kpi">
            <p className="pulse-clean-header__kpi-label">Avg Adoption Score</p>
            <p className="pulse-clean-header__kpi-value">{formatScore(topCardAdoptionScore)}</p>
            <p className="pulse-clean-header__kpi-meta">/40 this timepoint</p>
            <p className={`pulse-clean-header__kpi-delta pulse-clean-header__kpi-delta--${deltaTone(topCardAdoptionDelta)}`}>
              {formatDelta(topCardAdoptionDelta)}
            </p>
          </div>
          <div className="pulse-clean-header__kpi">
            <p className="pulse-clean-header__kpi-label">Avg Sponsorship Score</p>
            <p className="pulse-clean-header__kpi-value">{formatScore(topCardSponsorshipScore)}</p>
            <p className="pulse-clean-header__kpi-meta">/40 this timepoint</p>
            <p className={`pulse-clean-header__kpi-delta pulse-clean-header__kpi-delta--${deltaTone(topCardSponsorshipDelta)}`}>
              {formatDelta(topCardSponsorshipDelta)}
            </p>
          </div>
        </div>

        {sponsorshipSignals?.headerAdoption?.text ? (
          <div className={`pulse-sa-signal ${sponsorshipSignalVariantClass(sponsorshipSignals.headerAdoption.variant)}`} style={{ marginTop: '0.8rem' }}>
            <span className="pulse-sa-signal__label">{sponsorshipSignals.headerAdoption.cardLabel || 'Signal'}</span>
            {renderSignalMarkup(sponsorshipSignals.headerAdoption.text)}
          </div>
        ) : null}
        {sponsorshipSignals?.headerSponsorship?.text ? (
          <div className={`pulse-sa-signal ${sponsorshipSignalVariantClass(sponsorshipSignals.headerSponsorship.variant)}`} style={{ marginTop: '0.55rem' }}>
            <span className="pulse-sa-signal__label">{sponsorshipSignals.headerSponsorship.cardLabel || 'Signal'}</span>
            {renderSignalMarkup(sponsorshipSignals.headerSponsorship.text)}
          </div>
        ) : null}

        </section>
      ) : null}

      {showingFullDashboard ? (
        <>
          <section className="pulse-org-overview">
            <article className="card pulse-org-overview__score-card">
              <div className="pulse-org-overview__header">
                <h3 className="pulse-org-overview__title">Are your people ready?</h3>
              </div>
              <p className="pulse-org-overview__score">{formatScore(adoptionScore)}</p>
              <p className="pulse-org-overview__score-meta">Adoption Readiness /40</p>
              <p className="pulse-org-overview__quadrant-meta">Quadrant {topCardQuadrantLabel}</p>
              <p className="pulse-org-overview__blurb">{adoptionOverviewBlurb}</p>
              <div className="pulse-org-overview__signal">
                <p className="pulse-org-overview__signal-label">Why this matters</p>
                <p className="pulse-org-overview__signal-text">{renderSignalMarkup(adoptionWhyThisMatters)}</p>
              </div>
            </article>
            <article className="card pulse-org-overview__score-card">
              <div className="pulse-org-overview__header">
                <h3 className="pulse-org-overview__title">Can your managers drive the change?</h3>
              </div>
              <p className="pulse-org-overview__score">{formatScore(sponsorshipScore)}</p>
              <p className="pulse-org-overview__score-meta">Sponsorship Credibility /40</p>
              <p className="pulse-org-overview__quadrant-meta">Quadrant {topCardQuadrantLabel}</p>
              <p className="pulse-org-overview__blurb">{sponsorshipOverviewBlurb}</p>
              <div className="pulse-org-overview__signal">
                <p className="pulse-org-overview__signal-label">Why this matters</p>
                <p className="pulse-org-overview__signal-text">{renderSignalMarkup(sponsorshipWhyThisMatters)}</p>
              </div>
            </article>
          </section>

          <section className="card pulse-org-likelihood">
            <div className="pulse-org-likelihood__header">
              <p className="pulse-org-likelihood__eyebrow">{org?.name || 'Client'} · {reportDateLabel}</p>
              <p className="pulse-org-likelihood__verdict" aria-live="polite">{launchStatusLabel}</p>
              <h3 className="pulse-org-likelihood__title">Likelihood of Success?</h3>
            </div>
            <div className="pulse-sa-card" style={{ marginBottom: 0 }}>
              <p className="pulse-sa-card__label">Quadrant Journey</p>
              <p className="pulse-sa-card__explainer">
                Quadrant classification tracks whether score movement is improving toward Optimal or drifting into higher risk states.
              </p>
              <div className="pulse-clean-readiness__quadrants">
                {quadrants.map((quadrant) => (
                  <div
                    key={`overview-${quadrant.name}`}
                    className={`pulse-clean-readiness__quadrant pulse-clean-readiness__quadrant--${quadrantTone(quadrant.name)}`}
                  >
                    <p className="pulse-clean-readiness__quadrant-percent">{formatPercent(quadrant.percent)}</p>
                    <p className="pulse-clean-readiness__quadrant-name">{quadrant.name}</p>
                  </div>
                ))}
              </div>
              <p className="pulse-sa-card__explainer" style={{ marginTop: '0.8rem' }}>
                <strong>Score:</strong> {dominantQuadrant.name} ({formatPercent(dominantQuadrant.percent)})
              </p>
              <p className="pulse-sa-card__explainer" style={{ marginTop: '0.35rem' }}>
                <strong>What it means:</strong> {renderSignalMarkup(
                  likelihoodSignalText || 'Use the dominant quadrant to prioritise intervention and launch pacing.'
                )}
              </p>
            </div>

            {micDropScenarios.length > 0 ? (
              <div className="pulse-clean-exec__scenarios" style={{ marginTop: '1rem' }}>
                {micDropScenarios.map((scenario) => (
                  <article key={scenario.id} className="pulse-clean-exec__scenario">
                    <p className="pulse-clean-exec__scenario-tag">{scenario.tag}</p>
                    <h4 className="pulse-clean-exec__scenario-title">{scenario.title}</h4>
                    <p className="pulse-clean-exec__scenario-text">{scenario.textA}</p>
                    <p className="pulse-clean-exec__scenario-text">{scenario.textB}</p>
                    <p className="pulse-clean-exec__scenario-outcome">
                      <strong>Projected outcome:</strong> {scenario.outcome}
                    </p>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Loading dashboard data...</p> : null}

      {showTrendSection ? (
        <PulseTrendAnalysisSection
          loading={trendLoading}
          error={trendError}
          orderedStages={orderedTrendStages}
          divergenceFlags={trendDivergenceFlags}
          selectedTimepoint={pulseTimepoint}
          sectionSignals={trendSignals}
        />
      ) : null}

      {showReadinessSection ? (
        <section className="pulse-clean-readiness card">
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
        <section className="pulse-clean-scores pulse-sa">
          {/* ─── OVERALL VERDICT ─── */}
          <div className="pulse-sa-verdict">
            <p className="pulse-sa-verdict__meta">
              {dashboard?.sponsorshipAnalysis?.verdict?.provenance
                || `Sponsorship Analysis · ${org?.name || 'Client'} · ${reportDateLabel}`}
            </p>
            <div className="pulse-sa-verdict__main">
              <div>
                <h3 className="pulse-sa-verdict__title">
                  {dashboard?.sponsorshipAnalysis?.verdict?.headline
                    || `The sponsorship chain is ${interventionRequired ? 'not functioning' : 'functioning'}.`}
                </h3>
                <p className="pulse-sa-verdict__body">
                  {dashboard?.sponsorshipAnalysis?.verdict?.body || sponsorshipExecutiveSignal}
                </p>
              </div>
              <span className={`pulse-sa-verdict__badge${!interventionRequired ? ' pulse-sa-verdict__badge--stable' : ''}`}>
                {dashboard?.sponsorshipAnalysis?.verdict?.badge || (interventionRequired ? '⚠ Intervention Required' : sponsorshipVerdict)}
              </span>
            </div>
            <div className="pulse-sa-verdict__foot">
              <span className="pulse-sa-verdict__provenance">
                Based on <strong>{dashboard?.sponsorshipAnalysis?.cohort?.managerRespondentCount ?? managerBreakdownRows.length} manager responses</strong>
              </span>
              <div className="pulse-sa-verdict__chips">
                {(dashboard?.sponsorshipAnalysis?.verdict?.chips || []).map((chip) => (
                  <span key={chip.label} className="pulse-sa-chip">{chip.label}: {chip.value}</span>
                ))}
              </div>
            </div>
          </div>

          {/* ─── SECTION 1: SUB-SCORE OVERVIEW ─── */}
          <div className="pulse-sa-card">
            <p className="pulse-sa-card__label">
              {dashboard?.sponsorshipAnalysis?.section1?.cardLabel || 'Section 1 — Sponsorship Sub-Score Overview'}
            </p>
            <p className="pulse-sa-card__explainer">
              {dashboard?.sponsorshipAnalysis?.section1?.explainer
                || 'Breaks the overall Sponsorship Credibility score into two distinct constructs: what managers are receiving from senior leadership above them, and whether managers have the conditions to sponsor their own teams below.'}
            </p>
            <div className="pulse-sa-subscores">
              <article className="pulse-sa-subscore">
                <p className="pulse-sa-subscore__eyebrow">Sponsorship Received</p>
                <p
                  className="pulse-sa-subscore__score"
                  style={{ color: thresholdSignalColor(dashboard?.sponsorshipAnalysis?.section1?.received?.status) }}
                >
                  {formatScore(dashboard?.sponsorshipAnalysis?.section1?.received?.avg ?? null)}
                </p>
                <p className="pulse-sa-subscore__denom">
                  /{dashboard?.sponsorshipAnalysis?.section1?.received?.denominator || 20} points
                  &nbsp;&nbsp;{dashboard?.sponsorshipAnalysis?.section1?.received?.questionRangeLabel || 'MQ9 — MQ12'}
                </p>
                <div className="pulse-sa-track">
                  <span
                    style={{
                      width: `${dashboard?.sponsorshipAnalysis?.section1?.received?.trackPercent || 0}%`,
                      background: thresholdSignalColor(dashboard?.sponsorshipAnalysis?.section1?.received?.status),
                    }}
                  />
                </div>
                <span
                  className={`pulse-sa-threshold-tag pulse-sa-threshold-tag--${normalizeThresholdStatus(
                    dashboard?.sponsorshipAnalysis?.section1?.received?.status
                  )}`}
                >
                  {normalizeThresholdStatus(dashboard?.sponsorshipAnalysis?.section1?.received?.status) === 'above'
                    ? 'Above Threshold'
                    : 'Below Threshold'}
                </span>
                <div className="pulse-sa-subscore__what">
                  <p className="pulse-sa-subscore__what-label">What this measures</p>
                  <p>{dashboard?.sponsorshipAnalysis?.section1?.whatThisMeasures?.received
                    || 'Whether senior leaders are visibly modelling the change, staying present under pressure, communicating the rationale clearly, and speaking with one voice.'}</p>
                </div>
              </article>
              <article className="pulse-sa-subscore">
                <p className="pulse-sa-subscore__eyebrow">Sponsorship Capacity</p>
                <p
                  className="pulse-sa-subscore__score"
                  style={{ color: thresholdSignalColor(dashboard?.sponsorshipAnalysis?.section1?.capacity?.status) }}
                >
                  {formatScore(dashboard?.sponsorshipAnalysis?.section1?.capacity?.avg ?? null)}
                </p>
                <p className="pulse-sa-subscore__denom">
                  /{dashboard?.sponsorshipAnalysis?.section1?.capacity?.denominator || 20} points
                  &nbsp;&nbsp;{dashboard?.sponsorshipAnalysis?.section1?.capacity?.questionRangeLabel || 'MQ13 — MQ16'}
                </p>
                <div className="pulse-sa-track">
                  <span
                    style={{
                      width: `${dashboard?.sponsorshipAnalysis?.section1?.capacity?.trackPercent || 0}%`,
                      background: thresholdSignalColor(dashboard?.sponsorshipAnalysis?.section1?.capacity?.status),
                    }}
                  />
                </div>
                <span
                  className={`pulse-sa-threshold-tag pulse-sa-threshold-tag--${normalizeThresholdStatus(
                    dashboard?.sponsorshipAnalysis?.section1?.capacity?.status
                  )}`}
                >
                  {normalizeThresholdStatus(dashboard?.sponsorshipAnalysis?.section1?.capacity?.status) === 'above'
                    ? 'Above Threshold'
                    : 'Below Threshold'}
                </span>
                <div className="pulse-sa-subscore__what">
                  <p className="pulse-sa-subscore__what-label">What this measures</p>
                  <p>{dashboard?.sponsorshipAnalysis?.section1?.whatThisMeasures?.capacity
                    || 'Whether managers have the autonomy, organisational support, personal resilience, and change leadership skills to sponsor their own teams effectively.'}</p>
                </div>
              </article>
            </div>
            {sponsorshipSignals?.subScores?.text ? (
              <div className="pulse-sa-signal pulse-sa-signal--amber">
                <span className="pulse-sa-signal__label">Signal</span>
                {renderSignalMarkup(sponsorshipSignals.subScores.text)}
              </div>
            ) : null}
          </div>

          {/* ─── SECTION 2: MANAGER LOAD ─── */}
          <div className="pulse-sa-card">
            <p className="pulse-sa-card__label">
              {dashboard?.sponsorshipAnalysis?.section2?.cardLabel || 'Section 2 — Manager Load Report'}
            </p>
            <p className="pulse-sa-card__explainer">
              {dashboard?.sponsorshipAnalysis?.section2?.explainer
                || 'Measures the current capacity of each manager to absorb and lead additional change — scored from four questions about their workload, bandwidth, and self-reported saturation level.'}
            </p>
            <div className="pulse-sa-load-bar">
              {managerLoadDistribution.map((item) => (
                <span
                  key={item.band}
                  className={`pulse-sa-load-segment ${loadBandClassName(item.band)}`}
                  style={{ flex: Math.max(1, item.count) }}
                />
              ))}
            </div>
            {overloadedPercent > 10 ? (
              <span className="pulse-sa-inline-alert">⚠ CRITICAL — {formatPercent(overloadedPercent)} overloaded</span>
            ) : null}
            <div className="pulse-sa-load-grid">
              {managerLoadDistribution.map((item) => (
                <article key={item.band} className={`pulse-sa-load-cell ${loadBandClassName(item.band)}`}>
                  <p className="pulse-sa-load-cell__pct" style={{ color: loadBandColor(item.band) }}>
                    {formatPercent(item.percent)}
                  </p>
                  <p className="pulse-sa-load-cell__name">{item.band}</p>
                  <p className="pulse-sa-load-cell__desc">{loadBandDescription(item.band)}</p>
                </article>
              ))}
            </div>
            {sponsorshipSignals?.load?.text ? (
              <div className="pulse-sa-signal pulse-sa-signal--red">
                <span className="pulse-sa-signal__label">Signal</span>
                {sponsorshipSignals.load.text}
              </div>
            ) : null}
          </div>

          {/* ─── SECTION 3: CHAIN MATRIX ─── */}
          <div className="pulse-sa-card">
            <p className="pulse-sa-card__label">
              {dashboard?.sponsorshipAnalysis?.section3?.cardLabel || 'Section 3 — Sponsorship Chain Matrix'}
            </p>
            <p className="pulse-sa-card__explainer">
              {dashboard?.sponsorshipAnalysis?.section3?.explainer
                || 'Classifies each manager respondent into one of four sponsorship chain states by crossing whether they are receiving adequate senior sponsorship with whether they have the capacity to sponsor their own team.'}
            </p>
            <div className="pulse-sa-chain-grid">
              {chainMatrixQuadOrder.map((quad) => {
                const item = chainStatusDistribution.find((s) => s.status === quad.status) || { percent: 0 };
                const isMajority = dashboard?.sponsorshipAnalysis?.section3?.majorityState === quad.backendName
                  || (!dashboard?.sponsorshipAnalysis?.section3?.majorityState && item.percent > 0
                    && item.percent === Math.max(...chainStatusDistribution.map((s) => s.percent)));
                return (
                  <article key={quad.status} className={`pulse-sa-chain-tile ${quad.className}`}>
                    {isMajority ? <span className="pulse-sa-chain-tile__majority">◀ Majority</span> : null}
                    <p className="pulse-sa-chain-tile__pct">
                      {formatPercent(item.percent)}
                    </p>
                    <p className="pulse-sa-chain-tile__name">{quad.label}</p>
                    <p className="pulse-sa-load-cell__desc">{quad.description}</p>
                  </article>
                );
              })}
            </div>
            <div className="pulse-sa-axis" style={{ marginTop: '0.5rem' }}>
              <span>← Low received sponsorship</span>
              <span>High received sponsorship →</span>
            </div>
            {sponsorshipSignals?.chain?.text ? (
              <div className="pulse-sa-signal pulse-sa-signal--orange">
                <span className="pulse-sa-signal__label">Note</span>
                {renderSignalMarkup(sponsorshipSignals.chain.text)}
              </div>
            ) : null}
          </div>

          {/* ─── SECTION 4: LOAD BAND × CHAIN STATE ─── */}
          <div className="pulse-sa-card">
            <p className="pulse-sa-card__label">
              {dashboard?.sponsorshipAnalysis?.section4?.cardLabel || 'Section 4 — Load Band × Chain State'}
            </p>
            <p className="pulse-sa-card__explainer">
              {dashboard?.sponsorshipAnalysis?.section4?.explainer
                || 'Crosses manager capacity (load band) against sponsorship chain state to identify which specific managers are simultaneously overloaded and unsupported — the group where intervention is most urgent.'}
            </p>
            <div className="pulse-sa-table-wrap">
              <table className="pulse-sa-matrix">
                <thead>
                  <tr>
                    <th>Load Band</th>
                    {(dashboard?.sponsorshipAnalysis?.section4?.columnOrder || loadByChainMatrix.statuses).map((col) => (
                      <th key={`sa-col-${col}`}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(dashboard?.sponsorshipAnalysis?.section4?.rows || []).map((row) => (
                    <tr key={row.loadBand}>
                      <td style={{ textAlign: 'left', fontWeight: 600 }}>{row.loadBand}</td>
                      {row.cells.map((cell) => (
                        <td key={`${row.loadBand}-${cell.chainState}`} className={cell.className || ''}>
                          <span className={`pulse-sa-matrix__count${cell.className === 'cx5' ? ' pulse-sa-matrix__count--critical' : ''}`}>
                            {cell.count}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!(dashboard?.sponsorshipAnalysis?.section4?.rows?.length) ? (
                    loadByChainMatrix.rows.map((row) => (
                      <tr key={row.band}>
                        <td style={{ textAlign: 'left', fontWeight: 600 }}>{row.band}</td>
                        {loadByChainMatrix.statuses.map((status) => (
                          <td key={`${row.band}-${status}`}>{row.cells[status] || 0}</td>
                        ))}
                      </tr>
                    ))
                  ) : null}
                </tbody>
              </table>
            </div>
            {sponsorshipSignals?.crossMatrix?.text ? (
              <div className="pulse-sa-signal pulse-sa-signal--red">
                <span className="pulse-sa-signal__label">Signal</span>
                {renderSignalMarkup(sponsorshipSignals.crossMatrix.text)}
              </div>
            ) : null}
          </div>

          {/* ─── SECTION 5: TEAM-LEVEL SPONSORSHIP CHAIN ─── */}
          {(dashboard?.sponsorshipAnalysis?.section5?.rows?.length > 0) ? (
            <div className="pulse-sa-card">
              <p className="pulse-sa-card__label">
                {dashboard.sponsorshipAnalysis.section5.cardLabel || 'Section 5 — Team-Level Sponsorship Chain Breakdown'}
              </p>
              <p className="pulse-sa-card__explainer">
                {dashboard.sponsorshipAnalysis.section5.explainer
                  || 'Maps the sponsorship chain state to each team — distinguishing teams with local failure from those experiencing the broader organisational pattern, and identifying which teams require targeted pre-launch engagement.'}
              </p>
              <div className="pulse-sa-table-wrap">
                <table className="pulse-sa-matrix">
                  <thead>
                    <tr>
                      <th>Team</th>
                      <th>Responses</th>
                      <th>Chain State</th>
                      <th>Load Band</th>
                      <th>Received Avg</th>
                      <th>Capacity Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.sponsorshipAnalysis.section5.rows.map((row) => (
                      <tr key={row.managerId}>
                        <td style={{ textAlign: 'left', fontWeight: 600 }}>{row.teamName}</td>
                        <td>{row.responses || 0}</td>
                        <td>
                          <span className={`pulse-sa-chain-pill ${chainStatePillClass(row.chainState)}`}>
                            {row.chainState}
                          </span>
                        </td>
                        <td>
                          <span className={`pulse-sa-load-text ${loadBandTextClassName(row.loadBand)}`}>
                            {row.loadBand}
                          </span>
                        </td>
                        <td>{formatScore(row.receivedAvg)}</td>
                        <td>{formatScore(row.capacityAvg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {dashboard.sponsorshipAnalysis.section5.totalRows > dashboard.sponsorshipAnalysis.section5.rows.length ? (
                <p className="pulse-sa-card__explainer" style={{ marginTop: '0.5rem', fontStyle: 'italic' }}>
                  Showing {dashboard.sponsorshipAnalysis.section5.rows.length} of {dashboard.sponsorshipAnalysis.section5.totalRows} teams
                </p>
              ) : null}
              {sponsorshipSignals?.teams?.text ? (
                <div className="pulse-sa-signal pulse-sa-signal--red">
                  <span className="pulse-sa-signal__label">Note</span>
                  {renderSignalMarkup(sponsorshipSignals.teams.text)}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {showTeamLevelSection ? (
        <section className="pulse-clean-dimensions card">
          <div className="pulse-clean-dimensions__head">
            <p className="pulse-clean-dimensions__eyebrow">Team-Level Overview</p>
            <h3 className="pulse-clean-dimensions__title">Employee/Manager Dimension Heatmap</h3>
            <p className="pulse-clean-dimensions__explainer">
              Each row shows question-level chips (Q1/Q2 and MQ1/MQ2 equivalents), cohort averages, and required flags.
              Intra-dimension divergence and perception gap flags trigger at {INTRA_DIMENSION_DIVERGENCE_THRESHOLD.toFixed(1)}+ points.
            </p>
          </div>

          <div className="table-wrap">
            <table className="pulse-clean-dimensions__table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Dimension</th>
                  <th>Emp Q1</th>
                  <th>Emp Q2</th>
                  <th>Emp Avg</th>
                  <th>Mgr Q1</th>
                  <th>Mgr Q2</th>
                  <th>Mgr Avg</th>
                  <th>Gap</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {dimensionHeatmapRows.map((dimension) => (
                  <tr key={dimension.id}>
                    <td className="pulse-clean-dimensions__id">{dimension.id}</td>
                    <td className="pulse-clean-dimensions__construct">
                      <p className="pulse-clean-dimensions__construct-label">
                        {dimension.employeeLabel} {'<->'} {dimension.managerLabel}
                      </p>
                      <p className="pulse-clean-dimensions__construct-meta">
                        {dimension.comparable ? 'Comparable pair' : 'Non-comparable pair'}
                        {' · '}
                        {dimensionQuestionLabel(dimension.employeeQuestionIds, 'Q', 0)} + {dimensionQuestionLabel(dimension.employeeQuestionIds, 'Q', 1)}
                        {' · '}
                        {dimensionQuestionLabel(dimension.managerQuestionIds, 'MQ', 0)} + {dimensionQuestionLabel(dimension.managerQuestionIds, 'MQ', 1)}
                      </p>
                    </td>
                    <td>
                      <span className={`pulse-clean-dimensions__heat pulse-clean-dimensions__heat--${heatTone(dimension.employee.q1Avg)}`}>
                        {formatScore(dimension.employee.q1Avg)}
                      </span>
                    </td>
                    <td>
                      <span className={`pulse-clean-dimensions__heat pulse-clean-dimensions__heat--${heatTone(dimension.employee.q2Avg)}`}>
                        {formatScore(dimension.employee.q2Avg)}
                      </span>
                    </td>
                    <td>
                      <span className={`pulse-clean-dimensions__heat pulse-clean-dimensions__heat--${heatTone(dimension.employee.avg)}`}>
                        {formatScore(dimension.employee.avg)}
                      </span>
                    </td>
                    <td>
                      <span className={`pulse-clean-dimensions__heat pulse-clean-dimensions__heat--${heatTone(dimension.manager.q1Avg)}`}>
                        {formatScore(dimension.manager.q1Avg)}
                      </span>
                    </td>
                    <td>
                      <span className={`pulse-clean-dimensions__heat pulse-clean-dimensions__heat--${heatTone(dimension.manager.q2Avg)}`}>
                        {formatScore(dimension.manager.q2Avg)}
                      </span>
                    </td>
                    <td>
                      <span className={`pulse-clean-dimensions__heat pulse-clean-dimensions__heat--${heatTone(dimension.manager.avg)}`}>
                        {formatScore(dimension.manager.avg)}
                      </span>
                    </td>
                    <td className={dimension.perceptionGapFlagged ? 'pulse-clean-dimensions__gap pulse-clean-dimensions__gap--flagged' : 'pulse-clean-dimensions__gap'}>
                      {dimension.comparable ? formatScore(dimension.gap) : '—'}
                    </td>
                    <td className="pulse-clean-dimensions__flags">
                      {dimension.employee.intraGapFlagged ? (
                        <span className="pulse-clean-dimensions__flag pulse-clean-dimensions__flag--ai">AI · Intra (emp)</span>
                      ) : null}
                      {dimension.manager.intraGapFlagged ? (
                        <span className="pulse-clean-dimensions__flag pulse-clean-dimensions__flag--ai">AI · Intra (mgr)</span>
                      ) : null}
                      {dimension.comparable && dimension.perceptionGapFlagged ? (
                        <span className="pulse-clean-dimensions__flag pulse-clean-dimensions__flag--ai">AI · Perception gap</span>
                      ) : null}
                      {!dimension.employee.intraGapFlagged
                        && !dimension.manager.intraGapFlagged
                        && !(dimension.comparable && dimension.perceptionGapFlagged) ? (
                          <span className="pulse-clean-dimensions__gap">—</span>
                        ) : null}
                    </td>
                  </tr>
                ))}
                {dimensionHeatmapRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="muted">No dimension data available yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
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
              {visibleGroupedTeamRows.map((row) => (
                <tr key={row.key}>
                  <td className="pulse-clean-groups__name">
                    <div className="pulse-clean-groups__name-content" style={{ paddingLeft: `${row.depth * 1.1}rem` }}>
                      {row.hasChildren ? (
                        <button
                          type="button"
                          className="pulse-clean-groups__toggle"
                          onClick={() => toggleGroupRow(row.key)}
                          aria-expanded={Boolean(expandedGroupKeys[row.key])}
                          aria-label={`${expandedGroupKeys[row.key] ? 'Collapse' : 'Expand'} ${row.name}`}
                        >
                          <span
                            className={`pulse-clean-groups__chevron${expandedGroupKeys[row.key] ? ' is-open' : ''}`}
                            aria-hidden="true"
                          >
                            {'>'}
                          </span>
                          <span>{row.name}</span>
                        </button>
                      ) : (
                        <span className="pulse-clean-groups__leaf">{`${row.depth > 0 ? '- ' : ''}${row.name}`}</span>
                      )}
                    </div>
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

    </div>
  );
}
