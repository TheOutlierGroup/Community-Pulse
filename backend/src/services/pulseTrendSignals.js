const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_CLAUDE_MODEL =
  process.env.CLAUDE_TREND_SIGNALS_MODEL ||
  process.env.CLAUDE_SUMMARY_MODEL ||
  process.env.REPORT_AI_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  'claude-sonnet-4-20250514';

function readPositiveIntEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function trendSignalsTimeoutMs() {
  return readPositiveIntEnv('CLAUDE_TREND_SIGNALS_TIMEOUT_MS', 2500);
}

function stageDelta(stages, accessor) {
  const available = stages.filter((stage) => stage?.available);
  if (available.length < 2) return null;
  const latest = accessor(available[available.length - 1]);
  const previous = accessor(available[available.length - 2]);
  if (!Number.isFinite(latest) || !Number.isFinite(previous)) return null;
  return latest - previous;
}

function formatDelta(value, minDigits = 1, maxDigits = 3) {
  if (!Number.isFinite(value)) return '--';
  let digits = minDigits;
  while (
    digits < maxDigits
    && value !== 0
    && Number(value.toFixed(digits)) === 0
  ) {
    digits += 1;
  }
  const formatted = value.toFixed(digits);
  return value > 0 ? `+${formatted}` : formatted;
}

function buildCrossStageDivergenceFlags(stages, threshold = 1.0) {
  const dimensionOrder = ['1A', '1B', '1C', '1D', '2A', '2B', '2C', '2D'];
  const flags = [];
  const available = stages.filter((stage) => stage?.available);
  for (let idx = 1; idx < available.length; idx += 1) {
    const from = available[idx - 1];
    const to = available[idx];
    for (const dimensionId of dimensionOrder) {
      const employeeFrom = from?.dimensions?.employee?.[dimensionId];
      const employeeTo = to?.dimensions?.employee?.[dimensionId];
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
      const managerFrom = from?.dimensions?.manager?.[dimensionId];
      const managerTo = to?.dimensions?.manager?.[dimensionId];
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
    }
  }
  return flags.sort((a, b) => {
    const byAbs = Math.abs(b.delta) - Math.abs(a.delta);
    if (byAbs !== 0) return byAbs;
    if (a.delta < 0 && b.delta > 0) return -1;
    if (a.delta > 0 && b.delta < 0) return 1;
    return a.dimensionId.localeCompare(b.dimensionId);
  });
}

function latestAvailableStage(stages) {
  for (let idx = stages.length - 1; idx >= 0; idx -= 1) {
    if (stages[idx]?.available) return stages[idx];
  }
  return null;
}

function defaultTrendSignals(stages) {
  const currentStage = latestAvailableStage(stages);
  const adoptionDelta = stageDelta(stages, (stage) => stage?.adoptionScore);
  const sponsorshipDelta = stageDelta(stages, (stage) => stage?.sponsorshipScore);
  const receivedDelta = stageDelta(stages, (stage) => stage?.receivedAvg);
  const capacityDelta = stageDelta(stages, (stage) => stage?.capacityAvg);
  const chainDelta = stageDelta(stages, (stage) => stage?.chainStates?.['Chain Functioning']);
  const divergenceFlags = buildCrossStageDivergenceFlags(stages, 1.0);

  const section1Headline = Math.abs(adoptionDelta || 0) >= Math.abs(sponsorshipDelta || 0)
    ? 'Adoption has moved the most.'
    : 'Sponsorship has moved the most.';
  const section3Headline = (currentStage?.receivedAvg ?? Infinity) <= (currentStage?.capacityAvg ?? Infinity)
    ? 'Received is currently the weaker sub-score.'
    : 'Capacity is currently the weaker sub-score.';
  const section4Headline = (currentStage?.loadBands?.Overloaded || 0) >= 10
    ? `Critical load threshold breached (${Math.round(currentStage?.loadBands?.Overloaded || 0)}% overloaded).`
    : 'Overloaded band remains below critical threshold.';
  const section6Headline = (currentStage?.dimensions?.manager?.['1C'] || 0) < (currentStage?.dimensions?.manager?.['2D'] || 0)
    ? 'Change Saturation is the tighter constraint on manager capacity.'
    : 'Manager Wellbeing is the tighter constraint on manager capacity.';
  const section8Headline = Number(currentStage?.perceptionGap || 0) > 0
    ? 'Managers are currently overestimating sponsorship delivery versus employee experience.'
    : 'Managers are not overestimating sponsorship delivery at the current stage.';

  return {
    section1: `<strong>${section1Headline}</strong> Latest deltas are Adoption ${formatDelta(adoptionDelta)} and Sponsorship ${formatDelta(sponsorshipDelta)}.`,
    section2: `<strong>Current quadrant is ${currentStage?.quadrant || '--'}.</strong> Use this trajectory to set leadership intervention priority.`,
    section3: `<strong>${section3Headline}</strong> Latest deltas: Received ${formatDelta(receivedDelta)}, Capacity ${formatDelta(capacityDelta)}.`,
    section4: `<strong>${section4Headline}</strong> Adjust pace and support based on this distribution.`,
    section5: '<strong>Dimension movement is available across the stages shown.</strong> Prioritise the largest shifts in employee dimensions.',
    section6: `<strong>${section6Headline}</strong> Use this as an early warning for sponsorship chain strain.`,
    section7: `<strong>Chain Functioning is ${Math.round(currentStage?.chainStates?.['Chain Functioning'] || 0)}% at the current stage.</strong> Delta vs prior stage: ${formatDelta(chainDelta)}pp.`,
    section8: `<strong>${section8Headline}</strong> Track whether the gap narrows or widens in the next wave.`,
    section9: divergenceFlags.length > 0
      ? `<strong>${divergenceFlags[0].delta > 0 ? 'Largest flagged movement is an improvement.' : 'Largest flagged movement is a decline.'}</strong> Prioritise intervention around ${divergenceFlags[0].dimensionId} (${divergenceFlags[0].transition}).`
      : null,
  };
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

function extractJsonObject(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to fenced JSON extraction.
  }
  const match = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

async function requestTrendSignalsFromAi({ orgName, selectedTimepoint, stages }) {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    const missing = new Error('ANTHROPIC_API_KEY missing');
    missing.code = 'CLAUDE_KEY_MISSING';
    throw missing;
  }

  const prompt = [
    'Return a JSON object with keys section1..section9.',
    'Each value must be plain text with at most 2 sentences and may include <strong> tags around one key finding.',
    'Use factual tone for a change-readiness dashboard.',
    'If no clear finding exists for a section, still return a useful concise line.',
    '',
    `Org: ${orgName || 'Unknown org'}`,
    `Selected stage context: ${selectedTimepoint || 'unknown'}`,
    'Stage snapshots:',
    JSON.stringify(stages),
    '',
    'Output JSON only.',
  ].join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), trendSignalsTimeoutMs());
  let response;
  try {
    response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_CLAUDE_MODEL,
        system: 'You write concise executive signal banners for dashboard sections.',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 120,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Trend signal AI request timed out');
      timeoutError.code = 'CLAUDE_REQUEST_ABORTED';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const failure = new Error(`Trend signal AI request failed (${response.status})`);
    failure.code = 'CLAUDE_REQUEST_FAILED';
    throw failure;
  }
  const payload = await response.json();
  const text = extractResponseText(payload);
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== 'object') {
    const invalid = new Error('Trend signal AI response was not valid JSON');
    invalid.code = 'CLAUDE_INVALID_RESPONSE';
    throw invalid;
  }
  return parsed;
}

export async function generatePulseTrendSignals({ orgName, selectedTimepoint, stages }) {
  const fallbackSignals = defaultTrendSignals(Array.isArray(stages) ? stages : []);
  try {
    const aiSignals = await requestTrendSignalsFromAi({ orgName, selectedTimepoint, stages });
    return {
      source: 'ai',
      signals: {
        ...fallbackSignals,
        ...aiSignals,
      },
    };
  } catch {
    return {
      source: 'fallback',
      signals: fallbackSignals,
    };
  }
}
