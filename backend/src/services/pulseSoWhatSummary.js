const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_CLAUDE_MODEL =
  process.env.CLAUDE_SUMMARY_MODEL ||
  process.env.REPORT_AI_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  'claude-sonnet-4-20250514';

function readPositiveIntEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function summaryTimeoutMs() {
  return readPositiveIntEnv('CLAUDE_SUMMARY_TIMEOUT_MS', 2500);
}

function summaryMaxRetries() {
  return readPositiveIntEnv('CLAUDE_SUMMARY_MAX_RETRIES', 2);
}

function summaryRetryBaseDelayMs() {
  return readPositiveIntEnv('CLAUDE_SUMMARY_RETRY_BASE_DELAY_MS', 250);
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
  const content = Array.isArray(payload.content) ? payload.content : [];
  for (const block of content) {
    if (block?.type === 'text' && typeof block?.text === 'string' && block.text.trim()) {
      return block.text.trim();
    }
    if (typeof block?.text === 'string' && block.text.trim()) {
      return block.text.trim();
    }
  }
  if (typeof payload.completion === 'string' && payload.completion.trim()) {
    return payload.completion.trim();
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

function extractAnthropicErrorMessage(rawBody) {
  if (typeof rawBody !== 'string') return '';
  const body = rawBody.trim();
  if (!body) return '';
  try {
    const parsed = JSON.parse(body);
    const errorMessage = parsed?.error?.message;
    if (typeof errorMessage === 'string' && errorMessage.trim()) return errorMessage.trim();
  } catch {
    // Ignore parse errors and fall back to the raw body.
  }
  return body.slice(0, 200);
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

function claudeAuthKey() {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('ANTHROPIC_API_KEY is required for Rhythm Engine dashboard summaries');
    error.code = 'CLAUDE_KEY_MISSING';
    throw error;
  }
  return apiKey;
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isRetryableError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (code === 'ABORT_ERR' || code === 'CLAUDE_REQUEST_ABORTED' || code === 'CLAUDE_NETWORK_ERROR') {
    return true;
  }
  const status = Number(error?.status);
  if (Number.isFinite(status)) return isRetryableStatus(status);
  return false;
}

async function requestClaudeText({ prompt, maxOutputTokens = 120, temperature = 0.3 }) {
  const apiKey = claudeAuthKey();
  const body = {
    model: DEFAULT_CLAUDE_MODEL,
    system: 'You summarize operational analytics for executives with high precision and brevity.',
    messages: [{ role: 'user', content: prompt }],
    temperature,
    max_tokens: maxOutputTokens,
  };
  const maxRetries = summaryMaxRetries();
  const maxAttempts = maxRetries + 1;
  const timeoutMs = summaryTimeoutMs();
  const retryBaseDelayMs = summaryRetryBaseDelayMs();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const anthropicMessage = extractAnthropicErrorMessage(errorBody);
        const detail = anthropicMessage ? `: ${anthropicMessage}` : '';
        const error = new Error(`Claude summary request failed (${response.status})${detail}`);
        error.code = 'CLAUDE_REQUEST_FAILED';
        error.status = response.status;
        error.responseBody = errorBody;
        throw error;
      }
      const payload = await response.json();
      const text = normalizeSummary(extractResponseText(payload));
      if (!text) {
        const error = new Error('Claude summary response was empty');
        error.code = 'CLAUDE_EMPTY_RESPONSE';
        throw error;
      }
      return { text, attempts: attempt };
    } catch (error) {
      let normalized = error;
      if (error?.name === 'AbortError') {
        normalized = new Error('Claude summary request timed out');
        normalized.code = 'CLAUDE_REQUEST_ABORTED';
      } else if (String(error?.code || '').toUpperCase() === 'TYPEERROR') {
        normalized = new Error('Claude network request failed');
        normalized.code = 'CLAUDE_NETWORK_ERROR';
      }

      const canRetry = attempt < maxAttempts && isRetryableError(normalized);
      if (!canRetry) throw normalized;
      const delayMs = retryBaseDelayMs * attempt;
      await sleep(delayMs);
    } finally {
      clearTimeout(timer);
    }
  }

  const exhausted = new Error('Claude summary retries exhausted');
  exhausted.code = 'CLAUDE_RETRIES_EXHAUSTED';
  throw exhausted;
}

export async function generatePulseSoWhatSummary(snapshot) {
  try {
    const { text } = await requestClaudeText({
      prompt: buildPrompt(snapshot),
      maxOutputTokens: 120,
      temperature: 0.3,
    });
    return text;
  } catch (error) {
    console.error('Rhythm Engine so-what summary generation failed:', error?.message || error);
    const wrapped = new Error('AI summary unavailable');
    wrapped.code = error?.code || 'CLAUDE_SUMMARY_UNAVAILABLE';
    wrapped.cause = error;
    throw wrapped;
  }
}

export async function checkPulseSoWhatSummaryHealth({ live = true } = {}) {
  const model = DEFAULT_CLAUDE_MODEL;
  const retries = summaryMaxRetries();
  const timeoutMs = summaryTimeoutMs();
  const apiKeyPresent = Boolean(String(process.env.ANTHROPIC_API_KEY || '').trim());

  if (!apiKeyPresent) {
    return {
      ok: false,
      mode: live ? 'live' : 'config',
      code: 'CLAUDE_KEY_MISSING',
      message: 'ANTHROPIC_API_KEY is not configured',
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
    const { attempts } = await requestClaudeText({
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
      code: error?.code || 'CLAUDE_PROBE_FAILED',
      message: error?.message || 'AI summary probe failed',
      model,
      retries,
      timeoutMs,
      latencyMs: Date.now() - startedAt,
    };
  }
}
