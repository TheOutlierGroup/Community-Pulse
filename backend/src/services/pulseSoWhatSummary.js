const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_SUMMARY_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';

function readPositiveIntEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function summaryTimeoutMs() {
  return readPositiveIntEnv('OPENAI_SUMMARY_TIMEOUT_MS', 2500);
}

function summaryMaxRetries() {
  return readPositiveIntEnv('OPENAI_SUMMARY_MAX_RETRIES', 2);
}

function summaryRetryBaseDelayMs() {
  return readPositiveIntEnv('OPENAI_SUMMARY_RETRY_BASE_DELAY_MS', 250);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.round(value), 100));
}

function extractResponseText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const block of content) {
      if (typeof block?.text === 'string' && block.text.trim()) {
        return block.text.trim();
      }
    }
  }
  return '';
}

function normalizeSummary(text) {
  if (typeof text !== 'string') return '';
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const bounded = compact.slice(0, 320);
  return bounded.replace(/[.!?]+$/, '').trim() + '.';
}

function buildPrompt(snapshot) {
  const alertTitles = Array.isArray(snapshot?.alertTitles) ? snapshot.alertTitles.slice(0, 3) : [];
  return [
    'Write one concise "so what" insight for a change-readiness dashboard.',
    'Goal: prompt action without giving a full analysis.',
    'Rules:',
    '- 1-2 sentences, maximum 45 words.',
    '- Focus on the single most important takeaway.',
    '- Use only the provided metrics. No fabrication.',
    '- Keep language executive and plain.',
    '',
    `Org: ${snapshot?.orgName || 'Unknown org'}`,
    `Completed responses: ${Number(snapshot?.completedTotal || 0)}`,
    `Adoption score (/40): ${snapshot?.adoptionScore ?? 'n/a'}`,
    `Sponsorship score (/40): ${snapshot?.sponsorshipScore ?? 'n/a'}`,
    `Threshold: ${snapshot?.threshold ?? 28}`,
    `Optimal quadrant (%): ${clampPercent(snapshot?.optimalPercent)}`,
    `High Risk quadrant (%): ${clampPercent(snapshot?.highRiskPercent)}`,
    `Overloaded managers (%): ${clampPercent(snapshot?.overloadedPercent)}`,
    `Top alerts: ${alertTitles.length ? alertTitles.join(' | ') : 'none'}`,
  ].join('\n');
}

function openAiAuthKey() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is required for Pulse dashboard summaries');
    error.code = 'OPENAI_KEY_MISSING';
    throw error;
  }
  return apiKey;
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isRetryableError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (code === 'ABORT_ERR' || code === 'OPENAI_REQUEST_ABORTED' || code === 'OPENAI_NETWORK_ERROR') {
    return true;
  }
  const status = Number(error?.status);
  if (Number.isFinite(status)) return isRetryableStatus(status);
  return false;
}

async function requestOpenAiText({ prompt, maxOutputTokens = 120, temperature = 0.3 }) {
  const apiKey = openAiAuthKey();
  const body = {
    model: DEFAULT_OPENAI_MODEL,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: 'You summarize operational analytics for executives with high precision and brevity.',
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: prompt }],
      },
    ],
    temperature,
    max_output_tokens: maxOutputTokens,
  };
  const maxRetries = summaryMaxRetries();
  const maxAttempts = maxRetries + 1;
  const timeoutMs = summaryTimeoutMs();
  const retryBaseDelayMs = summaryRetryBaseDelayMs();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = new Error(`OpenAI summary request failed (${response.status})`);
        error.code = 'OPENAI_REQUEST_FAILED';
        error.status = response.status;
        throw error;
      }
      const payload = await response.json();
      const text = normalizeSummary(extractResponseText(payload));
      if (!text) {
        const error = new Error('OpenAI summary response was empty');
        error.code = 'OPENAI_EMPTY_RESPONSE';
        throw error;
      }
      return { text, attempts: attempt };
    } catch (error) {
      let normalized = error;
      if (error?.name === 'AbortError') {
        normalized = new Error('OpenAI summary request timed out');
        normalized.code = 'OPENAI_REQUEST_ABORTED';
      } else if (String(error?.code || '').toUpperCase() === 'TYPEERROR') {
        normalized = new Error('OpenAI network request failed');
        normalized.code = 'OPENAI_NETWORK_ERROR';
      }

      const canRetry = attempt < maxAttempts && isRetryableError(normalized);
      if (!canRetry) throw normalized;
      const delayMs = retryBaseDelayMs * attempt;
      await sleep(delayMs);
    } finally {
      clearTimeout(timer);
    }
  }

  const exhausted = new Error('OpenAI summary retries exhausted');
  exhausted.code = 'OPENAI_RETRIES_EXHAUSTED';
  throw exhausted;
}

export async function generatePulseSoWhatSummary(snapshot) {
  try {
    const { text } = await requestOpenAiText({
      prompt: buildPrompt(snapshot),
      maxOutputTokens: 120,
      temperature: 0.3,
    });
    return text;
  } catch (error) {
    console.error('Pulse so-what summary generation failed:', error?.message || error);
    const wrapped = new Error('AI summary unavailable');
    wrapped.code = error?.code || 'OPENAI_SUMMARY_UNAVAILABLE';
    wrapped.cause = error;
    throw wrapped;
  }
}

export async function checkPulseSoWhatSummaryHealth({ live = true } = {}) {
  const model = DEFAULT_OPENAI_MODEL;
  const retries = summaryMaxRetries();
  const timeoutMs = summaryTimeoutMs();
  const apiKeyPresent = Boolean(String(process.env.OPENAI_API_KEY || '').trim());

  if (!apiKeyPresent) {
    return {
      ok: false,
      mode: live ? 'live' : 'config',
      code: 'OPENAI_KEY_MISSING',
      message: 'OPENAI_API_KEY is not configured',
      model,
      retries,
      timeoutMs,
    };
  }

  if (!live) {
    return {
      ok: true,
      mode: 'config',
      message: 'AI summary configuration looks present',
      model,
      retries,
      timeoutMs,
    };
  }

  const startedAt = Date.now();
  try {
    const { attempts } = await requestOpenAiText({
      prompt: 'Reply with exactly: OK',
      maxOutputTokens: 16,
      temperature: 0,
    });
    return {
      ok: true,
      mode: 'live',
      message: 'AI summary probe succeeded',
      model,
      attempts,
      retries,
      timeoutMs,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      mode: 'live',
      code: error?.code || 'OPENAI_PROBE_FAILED',
      message: error?.message || 'AI summary probe failed',
      model,
      retries,
      timeoutMs,
      latencyMs: Date.now() - startedAt,
    };
  }
}
