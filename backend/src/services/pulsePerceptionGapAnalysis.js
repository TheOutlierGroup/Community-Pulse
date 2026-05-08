const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_CLAUDE_MODEL =
  process.env.CLAUDE_PERCEPTION_GAP_MODEL ||
  process.env.CLAUDE_SUMMARY_MODEL ||
  process.env.REPORT_AI_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  'claude-sonnet-4-20250514';

export const PERCEPTION_GAP_ANALYSIS_THRESHOLD = 1.5;
export const PERCEPTION_GAP_ANALYSIS_MIN_SAMPLES = 5;

function readPositiveIntEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function analysisTimeoutMs() {
  return readPositiveIntEnv('CLAUDE_PERCEPTION_GAP_TIMEOUT_MS', 2500);
}

function formatScore(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '--';
}

function formatGap(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} pts` : '—';
}

function flaggedItemsFromDimensions(dimensions, threshold) {
  const items = [];
  for (const dimension of Array.isArray(dimensions) ? dimensions : []) {
    if (!dimension?.comparable) continue;
    const employeeAvg = Number(dimension.employee?.average);
    const managerAvg = Number(dimension.manager?.average);
    const dimensionGap = Number.isFinite(employeeAvg) && Number.isFinite(managerAvg)
      ? Math.abs(employeeAvg - managerAvg)
      : null;
    if (Number.isFinite(dimensionGap) && dimensionGap >= threshold) {
      items.push({
        kind: 'dimension',
        dimensionId: dimension.id,
        employeeLabel: dimension.label || dimension.id,
        managerLabel: dimension.managerLabel || dimension.label || dimension.id,
        employeeAvg,
        managerAvg,
        gap: dimensionGap,
      });
    }
    const employeeQ1 = Number(dimension.employee?.q1Avg);
    const managerQ1 = Number(dimension.manager?.q1Avg);
    const q1Gap = Number.isFinite(employeeQ1) && Number.isFinite(managerQ1)
      ? Math.abs(employeeQ1 - managerQ1)
      : null;
    if (Number.isFinite(q1Gap) && q1Gap >= threshold) {
      items.push({
        kind: 'question',
        dimensionId: dimension.id,
        questionPosition: 'q1',
        employeeLabel: dimension.label || dimension.id,
        construct:
          dimension.q1Construct
          || dimension.questions?.q1
          || `${dimension.id} · Question 1`,
        employeeAvg: employeeQ1,
        managerAvg: managerQ1,
        gap: q1Gap,
      });
    }
    const employeeQ2 = Number(dimension.employee?.q2Avg);
    const managerQ2 = Number(dimension.manager?.q2Avg);
    const q2Gap = Number.isFinite(employeeQ2) && Number.isFinite(managerQ2)
      ? Math.abs(employeeQ2 - managerQ2)
      : null;
    if (Number.isFinite(q2Gap) && q2Gap >= threshold) {
      items.push({
        kind: 'question',
        dimensionId: dimension.id,
        questionPosition: 'q2',
        employeeLabel: dimension.label || dimension.id,
        construct:
          dimension.q2Construct
          || dimension.questions?.q2
          || `${dimension.id} · Question 2`,
        employeeAvg: employeeQ2,
        managerAvg: managerQ2,
        gap: q2Gap,
      });
    }
  }
  return items.sort((a, b) => b.gap - a.gap);
}

function describeDirection(employeeAvg, managerAvg) {
  if (!Number.isFinite(employeeAvg) || !Number.isFinite(managerAvg)) return 'diverge';
  return managerAvg > employeeAvg
    ? 'managers rate the experience more favourably than employees do'
    : 'employees rate the experience more favourably than managers do';
}

function buildFallbackNarrative({ items, threshold }) {
  if (!items.length) return null;
  const top = items.slice(0, 3);
  const headline = top.length === 1
    ? `One construct crosses the ${threshold.toFixed(1)}-point perception-gap threshold and warrants a calibration conversation.`
    : `${items.length} constructs cross the ${threshold.toFixed(1)}-point perception-gap threshold; the top ${top.length} are listed below.`;
  const lead = top
    .map((item) => {
      const label = item.kind === 'dimension'
        ? `${item.dimensionId} · ${item.employeeLabel} ↔ ${item.managerLabel}`
        : `${item.dimensionId} · ${item.construct}`;
      const direction = describeDirection(item.employeeAvg, item.managerAvg);
      return `${label} sits at a ${formatGap(item.gap)} gap (employee ${formatScore(item.employeeAvg)} vs manager ${formatScore(item.managerAvg)}) — ${direction}.`;
    })
    .join(' ');
  const closing =
    'These divergences point to misaligned signals between layers. Use them to seed a structured manager–employee conversation rather than treating either score as definitive.';
  return `${headline} ${lead} ${closing}`.replace(/\s+/g, ' ').trim();
}

function extractResponseText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const content = Array.isArray(payload.content) ? payload.content : [];
  for (const block of content) {
    if (block?.type === 'text' && typeof block?.text === 'string' && block.text.trim()) {
      return block.text.trim();
    }
  }
  return '';
}

function normalizeNarrative(text) {
  if (typeof text !== 'string') return '';
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.slice(0, 1200);
}

async function requestNarrativeFromAi({ orgName, items, threshold, employeeCount, managerCount }) {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('ANTHROPIC_API_KEY missing');
    error.code = 'CLAUDE_KEY_MISSING';
    throw error;
  }
  const prompt = [
    'You are summarising a single dashboard panel that explains employee/manager perception gaps for a change-readiness assessment.',
    'Write a 3-4 sentence narrative that:',
    '- States how many constructs crossed the threshold.',
    '- Names the top 1-3 flagged constructs by ID with their gap size and direction (which side scored higher).',
    '- Closes with one practical implication that prompts a calibration conversation.',
    'Rules: factual, executive tone, plain prose, no fabrication, no bullet lists, no markdown.',
    '',
    `Org: ${orgName || 'Unknown org'}`,
    `Threshold: ${threshold.toFixed(1)} points (gaps below this are not flagged).`,
    `Employee respondents: ${employeeCount}`,
    `Manager respondents: ${managerCount}`,
    'Flagged items (already filtered to gap >= threshold), sorted by gap size descending:',
    JSON.stringify(items.slice(0, 8), null, 2),
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), analysisTimeoutMs());
  try {
    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_CLAUDE_MODEL,
        system:
          'You write factual perception-gap commentary for change readiness dashboards. Output prose only.',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 320,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const failure = new Error(`Perception-gap AI request failed (${response.status})`);
      failure.code = 'CLAUDE_REQUEST_FAILED';
      throw failure;
    }
    const payload = await response.json();
    const text = normalizeNarrative(extractResponseText(payload));
    if (!text) {
      const empty = new Error('Perception-gap AI response was empty');
      empty.code = 'CLAUDE_EMPTY_RESPONSE';
      throw empty;
    }
    return text;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const aborted = new Error('Perception-gap AI request timed out');
      aborted.code = 'CLAUDE_REQUEST_ABORTED';
      throw aborted;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function buildPerceptionGapFlaggedItems({
  dimensions,
  threshold = PERCEPTION_GAP_ANALYSIS_THRESHOLD,
} = {}) {
  return flaggedItemsFromDimensions(dimensions, threshold);
}

export function buildPerceptionGapFallbackNarrative({
  items,
  threshold = PERCEPTION_GAP_ANALYSIS_THRESHOLD,
} = {}) {
  return buildFallbackNarrative({ items: Array.isArray(items) ? items : [], threshold });
}

export async function requestPerceptionGapAiNarrative({
  orgName,
  items,
  threshold = PERCEPTION_GAP_ANALYSIS_THRESHOLD,
  employeeCount = 0,
  managerCount = 0,
} = {}) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const text = await requestNarrativeFromAi({
    orgName,
    items,
    threshold,
    employeeCount,
    managerCount,
  });
  return text || null;
}

export async function generatePulsePerceptionGapAnalysis({
  orgName,
  dimensions,
  employeeCount,
  managerCount,
  threshold = PERCEPTION_GAP_ANALYSIS_THRESHOLD,
  minSampleSize = PERCEPTION_GAP_ANALYSIS_MIN_SAMPLES,
} = {}) {
  const sampleGate =
    Number(employeeCount || 0) >= minSampleSize
    && Number(managerCount || 0) >= minSampleSize;
  if (!sampleGate) {
    return {
      flagged: [],
      threshold,
      minSampleSize,
      sampleSizeMet: false,
      source: 'suppressed',
      text: null,
    };
  }
  const flagged = flaggedItemsFromDimensions(dimensions, threshold);
  if (flagged.length === 0) {
    return {
      flagged: [],
      threshold,
      minSampleSize,
      sampleSizeMet: true,
      source: 'none',
      text: null,
    };
  }
  const fallback = buildFallbackNarrative({ items: flagged, threshold });
  try {
    const aiText = await requestNarrativeFromAi({
      orgName,
      items: flagged,
      threshold,
      employeeCount,
      managerCount,
    });
    return {
      flagged,
      threshold,
      minSampleSize,
      sampleSizeMet: true,
      source: 'ai',
      text: aiText,
    };
  } catch {
    return {
      flagged,
      threshold,
      minSampleSize,
      sampleSizeMet: true,
      source: 'fallback',
      text: fallback,
    };
  }
}
