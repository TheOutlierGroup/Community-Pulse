import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
const PERCEPTION_GAP_MIN_SAMPLES = 5;
const DIMENSION_COMPARISON_META = {
  '1A': {
    sharedConstruct: 'Does the team have skills to absorb the change?',
    pairing: 'Strong',
    comparable: true,
    q1Construct: 'Skill support to perform in new ways',
    q2Construct: 'Capacity (time, energy, headspace) to learn',
  },
  '1B': {
    sharedConstruct: 'How has the org handled change historically?',
    pairing: 'Moderate',
    comparable: true,
    q1Construct: 'Past changes stuck without drifting back',
    q2Construct: 'Change delivered in an organised, manageable way',
  },
  '1C': {
    sharedConstruct: 'Different subjects, not directly comparable',
    pairing: 'Excluded',
    comparable: false,
    q1Construct: 'Volume of concurrent changes feels manageable',
    q2Construct: 'Bandwidth to absorb additional change',
  },
  '1D': {
    sharedConstruct: 'Is the layer above supporting the layer below?',
    pairing: 'Strong',
    comparable: true,
    q1Construct: 'Manager actively engages with change, not just passes info',
    q2Construct: 'Concerns raised during change are genuinely heard',
  },
  '2A': {
    sharedConstruct: 'Are senior leaders visibly committed?',
    pairing: 'Moderate',
    comparable: true,
    q1Construct: 'Senior leaders visibly model the change themselves',
    q2Construct: 'Leaders stay present and engaged when change gets hard',
  },
  '2B': {
    sharedConstruct: 'Are leaders modelling the change credibly?',
    pairing: 'Strong',
    comparable: true,
    q1Construct: 'Change applies to leaders as much as to staff',
    q2Construct: "Leaders' words match what actually happens",
  },
  '2C': {
    sharedConstruct: 'Different constructs, not directly comparable',
    pairing: 'Excluded',
    comparable: false,
    q1Construct: 'Honest about challenges, not just selling positives',
    q2Construct: 'Leaders adjust approach when something is not working',
  },
  '2D': {
    sharedConstruct: 'Is the environment safe and sustainable?',
    pairing: 'Strong',
    comparable: true,
    q1Construct: 'Safe to say you are struggling with change',
    q2Construct: 'Genuine support, not performance management',
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

function scoreTone(value, threshold = 28) {
  if (value == null || !Number.isFinite(value)) return 'neutral';
  if (value >= threshold) return 'positive';
  if (value >= threshold - 5) return 'caution';
  return 'risk';
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

function sponsorshipChainVerdictState(verdict, interventionRequired) {
  const fromBackend = String(verdict?.state || '').trim().toLowerCase();
  if (fromBackend === 'functioning' || fromBackend === 'monitoring' || fromBackend === 'failed') {
    return fromBackend;
  }

  const headline = String(verdict?.headline || '').trim().toLowerCase();
  if (headline.includes('not functioning') || headline.includes('failed')) return 'failed';
  if (headline.includes('monitor')) return 'monitoring';
  if (headline.includes('functioning')) return 'functioning';

  return interventionRequired ? 'failed' : 'functioning';
}

function sponsorshipChainVerdictPresentation(state) {
  if (state === 'failed') {
    return {
      statement: 'The sponsorship chain is not functioning.',
      subLabel: 'Managers are absorbing pressure from both directions and need immediate intervention to restore sponsorship flow.',
      className: 'pulse-sa-chain-verdict__statement--failed',
    };
  }

  if (state === 'monitoring') {
    return {
      statement: 'The sponsorship chain is being monitored.',
      subLabel: 'Core sponsorship conditions are holding, but active monitoring is required to prevent slippage in manager readiness.',
      className: 'pulse-sa-chain-verdict__statement--monitoring',
    };
  }

  return {
    statement: 'The sponsorship chain is functioning.',
    subLabel: 'Leaders are receiving support and have capacity to sponsor change through their teams.',
    className: 'pulse-sa-chain-verdict__statement--functioning',
  };
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
  const showTopSummaryCard = showingFullDashboard || showingSponsorshipOnly;
  const showTopSummaryScoreKpis = showingSponsorshipOnly;
  const showTopSummarySponsorshipSignals = showingSponsorshipOnly;
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
        q1Construct: '',
        q2Construct: '',
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
      const employeeCount = Number.isFinite(base?.employee?.count) ? base.employee.count : 0;
      const managerCount = Number.isFinite(base?.manager?.count) ? base.manager.count : 0;
      const signalsSuppressed =
        employeeCount < PERCEPTION_GAP_MIN_SAMPLES
        || managerCount < PERCEPTION_GAP_MIN_SAMPLES;
      return {
        id,
        employeeLabel: base.label || '--',
        managerLabel: base.managerLabel || '--',
        comparable,
        pairing: meta.pairing,
        sharedConstruct: meta.sharedConstruct,
        q1Construct: meta.q1Construct || '',
        q2Construct: meta.q2Construct || '',
        employeeQuestionIds,
        managerQuestionIds,
        signalsSuppressed,
        employee: {
          q1Avg: employeeQ1Avg,
          q2Avg: employeeQ2Avg,
          avg: employeeAvg,
          count: employeeCount,
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
          count: managerCount,
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
  const chainVerdictState = sponsorshipChainVerdictState(
    dashboard?.sponsorshipAnalysis?.verdict,
    interventionRequired
  );
  const chainVerdictPresentation = sponsorshipChainVerdictPresentation(chainVerdictState);
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

      const aggregateAdoption = weightedAverage((row) => row.adoptionScore);
      const aggregateSponsorship = weightedAverage((row) => row.sponsorshipScore);

      node.aggregate = {
        allManagers,
        responses: allManagers.reduce((sum, row) => sum + (row.directReportCompletedCount || 0), 0),
        adoption: aggregateAdoption,
        sponsorship: aggregateSponsorship,
        loadBand: majorityLabel(allManagers.map((row) => row.managerLoadBand), '--'),
        quadrant: quadrantForScores(aggregateAdoption, aggregateSponsorship, threshold) || '--',
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
  const quadrantSignal = dashboard?.quadrantSignal || {};
  const quadrantSignalText = String(
    quadrantSignal.text
    || quadrantSignal.fallback
    || 'The quadrant distribution shows what proportion of the organisation currently has the conditions in place to absorb and sustain this change. Review the Optimal percentage against the largest deficit segment to understand the scale of intervention required before this programme can proceed with confidence.'
  ).trim();
  const quadrantBannerVariant = (() => {
    const fromBackend = String(quadrantSignal.bannerVariant || '').trim().toLowerCase();
    if (fromBackend === 'red' || fromBackend === 'amber' || fromBackend === 'green') {
      return fromBackend;
    }
    const segments = [
      { name: 'Optimal', percent: Number(quadrants.find((q) => q.name === 'Optimal')?.percent) || 0, priority: 0 },
      { name: 'High Risk', percent: Number(quadrants.find((q) => q.name === 'High Risk')?.percent) || 0, priority: 1 },
      { name: 'Capable but Wary', percent: Number(quadrants.find((q) => q.name === 'Capable but Wary')?.percent) || 0, priority: 2 },
      { name: 'Motivated but Lost', percent: Number(quadrants.find((q) => q.name === 'Motivated but Lost')?.percent) || 0, priority: 2 },
    ].sort((a, b) => {
      if (b.percent !== a.percent) return b.percent - a.percent;
      return a.priority - b.priority;
    });
    const largest = segments[0];
    if (!largest || largest.percent <= 0 || largest.name === 'Optimal') return 'green';
    const nonOptimal = [
      { name: 'High Risk', percent: Number(quadrants.find((q) => q.name === 'High Risk')?.percent) || 0, priority: 0 },
      { name: 'Capable but Wary', percent: Number(quadrants.find((q) => q.name === 'Capable but Wary')?.percent) || 0, priority: 1 },
      { name: 'Motivated but Lost', percent: Number(quadrants.find((q) => q.name === 'Motivated but Lost')?.percent) || 0, priority: 1 },
    ]
      .filter((entry) => entry.percent > 0)
      .sort((a, b) => {
        if (b.percent !== a.percent) return b.percent - a.percent;
        return a.priority - b.priority;
      });
    if (nonOptimal[0]?.name === 'High Risk') return 'red';
    return 'amber';
  })();
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

    setTrendLoading(true);
    setTrendError('');
    try {
      const sharedParams = {};
      if (selectedManagerIds.length > 0) {
        sharedParams.managerIds = selectedManagerIds.join(',');
        sharedParams.includeManagerSelf = includeManagerSelf ? 'true' : 'false';
      }

      // Trend analysis always renders the canonical stage aggregates, independent of the
      // dropdown checkpoint selection on the rest of the page.
      const preParams = { ...sharedParams, timepoint: 'pre' };
      const duringParams = { ...sharedParams, timepoint: 'during' };
      const postParams = { ...sharedParams, timepoint: 'completed' };

      const [preResult, duringResult, postResult] = await Promise.allSettled([
        api.get(`/api/platform/organizations/${orgId}/rhythm-engine-dashboard`, { params: preParams }),
        api.get(`/api/platform/organizations/${orgId}/rhythm-engine-dashboard`, { params: duringParams }),
        api.get(`/api/platform/organizations/${orgId}/rhythm-engine-dashboard`, { params: postParams }),
      ]);

      const snapshotMap = {};
      if (preResult.status === 'fulfilled' && preResult.value?.data) {
        snapshotMap.pre = buildTrendStageSnapshot('pre', 'Pre-Change', preResult.value.data);
      }
      if (duringResult.status === 'fulfilled' && duringResult.value?.data) {
        snapshotMap.mid = buildTrendStageSnapshot('mid', 'During-Change', duringResult.value.data);
      }
      if (postResult.status === 'fulfilled' && postResult.value?.data) {
        snapshotMap.post = buildTrendStageSnapshot('post', 'Post-Change', postResult.value.data);
      }

      if (Object.keys(snapshotMap).length === 0) {
        throw new Error('No trend data returned');
      }

      let nextSignals = {};
      try {
        const { data } = await api.post(`/api/platform/organizations/${orgId}/pulse-trend-signals`, {
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
            <div className="pulse-clean-header__title-row">
              <h2 className="pulse-clean-header__title">{pageTitle}</h2>
              {showingSponsorshipOnly ? (
                <span className="pulse-clean-header__cohort-pill">Manager Cohort Only</span>
              ) : null}
            </div>
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
        {showingSponsorshipOnly ? (
          <div className="pulse-clean-header__cohort-banner">
            {'MANAGER COHORT VIEW \u2014 Scores on this page reflect manager responses only and will differ from organisation-wide figures.'}
          </div>
        ) : null}

        <div className={`pulse-clean-header__kpis${showingFullDashboard ? ' pulse-clean-header__kpis--with-verdict' : ''}`}>
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
          {showTopSummaryScoreKpis ? (
            <>
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
            </>
          ) : null}
          {showingFullDashboard ? (
            <div className="pulse-clean-header__kpi pulse-clean-header__kpi--verdict">
              <p className="pulse-clean-header__kpi-label">Likelihood of Success</p>
              <p
                className={`pulse-clean-header__verdict-pill pulse-clean-header__verdict-pill--${kpis.launchVerdict === 'cleared' ? 'cleared' : 'not-cleared'}`}
                aria-live="polite"
              >
                {launchStatusLabel}
              </p>
            </div>
          ) : null}
        </div>

        {showTopSummarySponsorshipSignals && sponsorshipSignals?.headerAdoption?.text ? (
          <div className={`pulse-sa-signal ${sponsorshipSignalVariantClass(sponsorshipSignals.headerAdoption.variant)}`} style={{ marginTop: '0.8rem' }}>
            <span className="pulse-sa-signal__label">{sponsorshipSignals.headerAdoption.cardLabel || 'Signal'}</span>
            {renderSignalMarkup(sponsorshipSignals.headerAdoption.text)}
          </div>
        ) : null}
        {showTopSummarySponsorshipSignals && sponsorshipSignals?.headerSponsorship?.text ? (
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
                <span className="pulse-org-overview__corner-badge" aria-label="Card marker A">A</span>
              </div>
              <p
                className="pulse-org-overview__score"
                style={
                  Number.isFinite(adoptionScore)
                    ? { color: adoptionScore >= 28 ? '#1E855D' : '#E52235' }
                    : undefined
                }
              >
                {formatScore(adoptionScore)}
              </p>
              <p className="pulse-org-overview__score-meta">Adoption Readiness /40</p>
              <p className="pulse-org-overview__blurb">{adoptionOverviewBlurb}</p>
              {Number.isFinite(adoptionScore) ? (
                <p className="pulse-org-overview__threshold-context">
                  The 28-point threshold represents an average question score of 3.5 across all eight adoption dimensions &mdash; the point at which the cohort as a whole is leaning positively rather than sitting on the fence. This score is {adoptionScore >= threshold ? 'above' : 'below'} it.
                </p>
              ) : null}
              <div className="pulse-org-overview__measures">
                <p className="pulse-org-overview__measures-label">What it measures</p>
                <p className="pulse-org-overview__measures-text">
                  Composite of four employee-survey dimensions, each scored 1&ndash;5 and rolled up to a 0&ndash;{40} scale. The {threshold}/40 line is the readiness floor for absorbing change at the current pace.
                </p>
                <ul className="pulse-org-overview__measures-list">
                  <li><span className="pulse-org-overview__measures-id">1A</span> Competence &amp; Capability</li>
                  <li><span className="pulse-org-overview__measures-id">1B</span> Change Track Record</li>
                  <li><span className="pulse-org-overview__measures-id">1C</span> Change Load / Capacity</li>
                  <li><span className="pulse-org-overview__measures-id">1D</span> Manager as Enabler</li>
                </ul>
              </div>
              <div className="pulse-org-overview__signal">
                <p className="pulse-org-overview__signal-label">Why this matters</p>
                <p className="pulse-org-overview__signal-text">{renderSignalMarkup(adoptionWhyThisMatters)}</p>
              </div>
            </article>
            <article className="card pulse-org-overview__score-card">
              <div className="pulse-org-overview__header">
                <h3 className="pulse-org-overview__title">Can your managers drive the change?</h3>
                <span className="pulse-org-overview__corner-badge" aria-label="Card marker B">B</span>
              </div>
              <p
                className="pulse-org-overview__score"
                style={
                  Number.isFinite(sponsorshipScore)
                    ? { color: sponsorshipScore >= 28 ? '#1E855D' : '#E52235' }
                    : undefined
                }
              >
                {formatScore(sponsorshipScore)}
              </p>
              <p className="pulse-org-overview__score-meta">Sponsorship Credibility /40</p>
              <p className="pulse-org-overview__blurb">{sponsorshipOverviewBlurb}</p>
              {Number.isFinite(sponsorshipScore) ? (
                <p className="pulse-org-overview__threshold-context">
                  The 28-point threshold represents an average question score of 3.5 across all eight sponsorship dimensions &mdash; the point at which the cohort as a whole is leaning positively rather than sitting on the fence. This score is {sponsorshipScore >= threshold ? 'above' : 'below'} it.
                </p>
              ) : null}
              <div className="pulse-org-overview__measures">
                <p className="pulse-org-overview__measures-label">What it measures</p>
                <p className="pulse-org-overview__measures-text">
                  Composite of <strong>Sponsorship Received</strong> (how visibly senior leaders are modelling the change &mdash; /20) and <strong>Sponsorship Capacity</strong> (whether managers have the load and conditions to pass sponsorship downward &mdash; /20). The {threshold}/40 line is the credibility floor for sustaining momentum through managers.
                </p>
                <ul className="pulse-org-overview__measures-list">
                  <li><span className="pulse-org-overview__measures-id">2A</span> Visible Sponsorship</li>
                  <li><span className="pulse-org-overview__measures-id">2B</span> Walk the Talk</li>
                  <li><span className="pulse-org-overview__measures-id">2C</span> Honest Communication</li>
                  <li><span className="pulse-org-overview__measures-id">2D</span> Psychological Safety</li>
                </ul>
              </div>
              <div className="pulse-org-overview__signal">
                <p className="pulse-org-overview__signal-label">Why this matters</p>
                <p className="pulse-org-overview__signal-text">{renderSignalMarkup(sponsorshipWhyThisMatters)}</p>
              </div>
            </article>
          </section>

          <section className="card pulse-org-likelihood">
            <div className="pulse-org-likelihood__header">
              <p className="pulse-org-likelihood__eyebrow">{org?.name || 'Client'} · {reportDateLabel}</p>
              <div className="pulse-org-likelihood__title-row">
                <h3 className="pulse-org-likelihood__title">Likelihood of Success?</h3>
                <span className="pulse-org-overview__corner-badge" aria-label="Card marker C">C</span>
              </div>
            </div>
            <div className="pulse-sa-card" style={{ marginBottom: 0 }}>
              <p className="pulse-sa-card__label">Quadrant Journey</p>
              <p className="pulse-sa-card__explainer">
                Quadrant classification tracks whether score movement is improving toward Optimal or drifting into higher risk states.
              </p>
              <div className="pulse-trend-card__measure" role="note" aria-label="What this measures">
                <p className="pulse-trend-card__measure-label">What this measures</p>
                <p className="pulse-trend-card__measure-text">
                  The quadrant is determined by crossing two scores: Adoption Readiness (whether the organisation has the capability, capacity, and managerial support to absorb the change) and Sponsorship Credibility (whether leadership is visibly and credibly driving it). Optimal means both are strong; High Risk means both are weak; Capable but Wary means sponsorship is strong but adoption is not; Motivated but Lost means adoption is strong but sponsorship is not.
                </p>
              </div>
              <div
                className={`pulse-quadrant-signal pulse-quadrant-signal--${quadrantBannerVariant}`}
                role="note"
                aria-label="Quadrant signal banner"
              >
                <span className="pulse-quadrant-signal__label">Signal</span>
                <p className="pulse-quadrant-signal__text">
                  {renderSignalMarkup(quadrantSignalText)}
                </p>
              </div>
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
          {/* ─── SECTION 1: SUB-SCORE OVERVIEW ─── */}
          <div className="pulse-sa-card">
            <p className="pulse-sa-card__label">
              {dashboard?.sponsorshipAnalysis?.section1?.cardLabel || 'AVG SCORE OVERVIEW · MANAGER COHORT ONLY'}
            </p>
            <p className="pulse-sa-card__explainer">
              {dashboard?.sponsorshipAnalysis?.section1?.explainer
                || 'The two average scores shown here reflect the manager cohort only and will differ from organisation-wide figures. Avg Adoption Score (0-40) measures whether the management layer has the capability, capacity, change track record, and upward enablement to absorb and drive the change across their teams. Avg Sponsorship Score (0-40) measures whether managers are both receiving credible sponsorship from senior leadership above them and have the capacity to sponsor their own teams below. A score of 28 or above in either dimension indicates HIGH classification. Both scores must be HIGH for the management layer to be considered ready.'}
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
            <div className="pulse-sa-chain-verdict">
              <p className={`pulse-sa-chain-verdict__statement ${chainVerdictPresentation.className}`}>
                {chainVerdictPresentation.statement}
              </p>
              <p className="pulse-sa-chain-verdict__sub-label">
                {chainVerdictPresentation.subLabel || sponsorshipExecutiveSignal}
              </p>
            </div>
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

          {/* ─── SECTION 4: TEAM-LEVEL SPONSORSHIP CHAIN ─── */}
          {(dashboard?.sponsorshipAnalysis?.section5?.rows?.length > 0) ? (
            <div className="pulse-sa-card">
              <p className="pulse-sa-card__label">
                {dashboard.sponsorshipAnalysis.section5.cardLabel || 'Section 4 — Team-Level Sponsorship Chain Breakdown'}
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
                  <span className="pulse-sa-signal__label">Signal</span>
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
              Each dimension expands into its two underlying questions so question-level divergence is visible at a glance.
              Diverged employee or manager chips outline in red; the Dim avg chip flags when the perception gap crosses {PERCEPTION_GAP_THRESHOLD.toFixed(1)}+ points.
              An AI signal appears next to a question whenever its employee/manager gap crosses {PERCEPTION_GAP_THRESHOLD.toFixed(1)}+ points,
              and intra-dimension divergence flags trigger at {INTRA_DIMENSION_DIVERGENCE_THRESHOLD.toFixed(1)}+ points.
            </p>
          </div>

          <div className="table-wrap">
            <table className="pulse-clean-dimensions__table">
              <colgroup>
                <col className="pulse-clean-dimensions__col-id" />
                <col className="pulse-clean-dimensions__col-construct" />
                <col className="pulse-clean-dimensions__col-score" />
                <col className="pulse-clean-dimensions__col-score" />
                <col className="pulse-clean-dimensions__col-gap" />
                <col className="pulse-clean-dimensions__col-dim-avg" />
              </colgroup>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Question / Construct</th>
                  <th>Employee</th>
                  <th>Manager</th>
                  <th>Gap</th>
                  <th>Dim avg</th>
                </tr>
              </thead>
              <tbody>
                {dimensionHeatmapRows.map((dimension) => {
                  const suppressSignals = dimension.signalsSuppressed;
                  const empIntra = !suppressSignals && dimension.employee.intraGapFlagged;
                  const mgrIntra = !suppressSignals && dimension.manager.intraGapFlagged;
                  const perceptionFlagged =
                    !suppressSignals && dimension.comparable && dimension.perceptionGapFlagged;
                  const empAvg = dimension.employee.avg;
                  const mgrAvg = dimension.manager.avg;
                  const dimAvg = (Number.isFinite(empAvg) && Number.isFinite(mgrAvg))
                    ? (empAvg + mgrAvg) / 2
                    : (Number.isFinite(empAvg) ? empAvg : (Number.isFinite(mgrAvg) ? mgrAvg : null));
                  const computeQGap = (e, m) => (
                    dimension.comparable && Number.isFinite(e) && Number.isFinite(m)
                      ? Math.abs(e - m)
                      : null
                  );
                  const q1Gap = computeQGap(dimension.employee.q1Avg, dimension.manager.q1Avg);
                  const q2Gap = computeQGap(dimension.employee.q2Avg, dimension.manager.q2Avg);
                  const q1GapFlagged =
                    !suppressSignals && q1Gap != null && q1Gap >= PERCEPTION_GAP_THRESHOLD;
                  const q2GapFlagged =
                    !suppressSignals && q2Gap != null && q2Gap >= PERCEPTION_GAP_THRESHOLD;
                  const empQ1Label = dimensionQuestionLabel(dimension.employeeQuestionIds, 'Q', 0);
                  const empQ2Label = dimensionQuestionLabel(dimension.employeeQuestionIds, 'Q', 1);
                  const mgrQ1Label = dimensionQuestionLabel(dimension.managerQuestionIds, 'MQ', 0);
                  const mgrQ2Label = dimensionQuestionLabel(dimension.managerQuestionIds, 'MQ', 1);
                  const heatClass = (value, extra) => [
                    'pulse-clean-dimensions__heat',
                    `pulse-clean-dimensions__heat--${heatTone(value)}`,
                    extra,
                  ].filter(Boolean).join(' ');
                  const constructLabel = `${dimension.employeeLabel} <-> ${dimension.managerLabel}`;
                  const q1Construct = dimension.q1Construct
                    || `${empQ1Label} / ${mgrQ1Label}`;
                  const q2Construct = dimension.q2Construct
                    || `${empQ2Label} / ${mgrQ2Label}`;
                  return (
                    <Fragment key={dimension.id}>
                      <tr className="pulse-clean-dimensions__dim-header">
                        <td className="pulse-clean-dimensions__id">{dimension.id}</td>
                        <td colSpan={5} className="pulse-clean-dimensions__dim-header-cell">
                          <div className="pulse-clean-dimensions__construct-row">
                            <div className="pulse-clean-dimensions__construct-heading">
                              <p className="pulse-clean-dimensions__construct-label">{constructLabel}</p>
                              {dimension.sharedConstruct ? (
                                <p className="pulse-clean-dimensions__construct-subtitle">{dimension.sharedConstruct}</p>
                              ) : null}
                            </div>
                            <div className="pulse-clean-dimensions__construct-flags">
                              <span className={`pulse-clean-dimensions__pair pulse-clean-dimensions__pair--${dimension.comparable ? 'comparable' : 'non'}`}>
                                {dimension.comparable ? 'Comparable pair' : 'Non-comparable pair'}
                              </span>
                              {empIntra ? (
                                <span className="pulse-clean-dimensions__flag pulse-clean-dimensions__flag--ai">AI · Intra (emp)</span>
                              ) : null}
                              {mgrIntra ? (
                                <span className="pulse-clean-dimensions__flag pulse-clean-dimensions__flag--ai">AI · Intra (mgr)</span>
                              ) : null}
                              {perceptionFlagged ? (
                                <span className="pulse-clean-dimensions__flag pulse-clean-dimensions__flag--ai">AI · Perception gap</span>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                      <tr className="pulse-clean-dimensions__q-row">
                        <td className="pulse-clean-dimensions__q-id">
                          <span className="pulse-clean-dimensions__q-id-text">{empQ1Label} / {mgrQ1Label}</span>
                        </td>
                        <td className="pulse-clean-dimensions__construct-cell">
                          <div className="pulse-clean-dimensions__construct-cell-row">
                            <p className="pulse-clean-dimensions__construct-cell-label">{q1Construct}</p>
                            {q1GapFlagged ? (
                              <span className="pulse-clean-dimensions__flag pulse-clean-dimensions__flag--ai">AI · Q1 gap</span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <span className={heatClass(dimension.employee.q1Avg, empIntra ? 'pulse-clean-dimensions__heat--diverged' : '')}>
                            {formatScore(dimension.employee.q1Avg)}
                          </span>
                        </td>
                        <td>
                          <span className={heatClass(dimension.manager.q1Avg, mgrIntra ? 'pulse-clean-dimensions__heat--diverged' : '')}>
                            {formatScore(dimension.manager.q1Avg)}
                          </span>
                        </td>
                        <td className={q1GapFlagged ? 'pulse-clean-dimensions__gap pulse-clean-dimensions__gap--flagged' : 'pulse-clean-dimensions__gap'}>
                          {q1Gap != null ? formatScore(q1Gap) : '—'}
                        </td>
                        <td rowSpan={2} className="pulse-clean-dimensions__dim-avg-cell">
                          <span className={heatClass(dimAvg, ['pulse-clean-dimensions__heat--dim', perceptionFlagged ? 'pulse-clean-dimensions__heat--flagged' : ''].filter(Boolean).join(' '))}>
                            {formatScore(dimAvg)}
                          </span>
                        </td>
                      </tr>
                      <tr className="pulse-clean-dimensions__q-row pulse-clean-dimensions__q-row--last">
                        <td className="pulse-clean-dimensions__q-id">
                          <span className="pulse-clean-dimensions__q-id-text">{empQ2Label} / {mgrQ2Label}</span>
                        </td>
                        <td className="pulse-clean-dimensions__construct-cell">
                          <div className="pulse-clean-dimensions__construct-cell-row">
                            <p className="pulse-clean-dimensions__construct-cell-label">{q2Construct}</p>
                            {q2GapFlagged ? (
                              <span className="pulse-clean-dimensions__flag pulse-clean-dimensions__flag--ai">AI · Q2 gap</span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <span className={heatClass(dimension.employee.q2Avg, empIntra ? 'pulse-clean-dimensions__heat--diverged' : '')}>
                            {formatScore(dimension.employee.q2Avg)}
                          </span>
                        </td>
                        <td>
                          <span className={heatClass(dimension.manager.q2Avg, mgrIntra ? 'pulse-clean-dimensions__heat--diverged' : '')}>
                            {formatScore(dimension.manager.q2Avg)}
                          </span>
                        </td>
                        <td className={q2GapFlagged ? 'pulse-clean-dimensions__gap pulse-clean-dimensions__gap--flagged' : 'pulse-clean-dimensions__gap'}>
                          {q2Gap != null ? formatScore(q2Gap) : '—'}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
                {dimensionHeatmapRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">No dimension data available yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {dashboard?.perceptionGapAnalysis?.text
            && dashboard.perceptionGapAnalysis.sampleSizeMet
            && dashboard.perceptionGapAnalysis.flaggedCount > 0 ? (
              <div className="pulse-clean-dimensions__analysis" role="note" aria-label="AI perception gap analysis">
                <div className="pulse-clean-dimensions__analysis-header">
                  <span className="pulse-clean-dimensions__analysis-label">AI · Perception Gap Analysis</span>
                  <span className="pulse-clean-dimensions__analysis-meta">
                    {dashboard.perceptionGapAnalysis.flaggedCount} flagged at {PERCEPTION_GAP_THRESHOLD.toFixed(1)}+ pts
                    {dashboard.perceptionGapAnalysis.source === 'fallback' ? ' · deterministic summary' : ''}
                  </span>
                </div>
                <p className="pulse-clean-dimensions__analysis-text">
                  {dashboard.perceptionGapAnalysis.text}
                </p>
              </div>
            ) : null}
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
                  <td>
                    <span className={`pulse-clean-groups__chip pulse-clean-groups__chip--${scoreTone(row.adoption, threshold)}`}>
                      {formatScore(row.adoption)}
                    </span>
                  </td>
                  <td>
                    <span className={`pulse-clean-groups__chip pulse-clean-groups__chip--${scoreTone(row.sponsorship, threshold)}`}>
                      {formatScore(row.sponsorship)}
                    </span>
                  </td>
                  <td>
                    {(() => {
                      const bandKey = ['Sustainable', 'Stretched', 'At Capacity', 'Overloaded'].includes(row.loadBand)
                        ? loadBandClassName(row.loadBand)
                        : 'unknown';
                      return (
                        <span className={`pulse-clean-groups__band pulse-clean-groups__band--${bandKey}`}>
                          {row.loadBand || '--'}
                        </span>
                      );
                    })()}
                  </td>
                  <td>
                    {(() => {
                      const isKnownQuadrant = ['Optimal', 'Motivated but Lost', 'Capable but Wary', 'High Risk'].includes(row.quadrant);
                      const tone = isKnownQuadrant ? quadrantTone(row.quadrant) : 'unknown';
                      return (
                        <span className={`pulse-clean-groups__quadrant pulse-clean-groups__quadrant--${tone}`}>
                          {row.quadrant || '--'}
                        </span>
                      );
                    })()}
                  </td>
                  <td>
                    <div className="pulse-clean-groups__spark">
                      {(row.trend || []).map((value, idx) => {
                        const tone = scoreTone(value, threshold);
                        return (
                          <span
                            key={`${row.key}-spark-${idx}`}
                            className={`pulse-clean-groups__spark-bar pulse-clean-groups__spark-bar--${tone}`}
                            style={{ height: `${Math.max(3, Math.min(18, ((value || 0) / 40) * 18))}px` }}
                          />
                        );
                      })}
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
