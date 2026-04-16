const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_SUMMARY_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';

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

export async function generatePulseSoWhatSummary(snapshot) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is required for Pulse dashboard summaries');
    error.code = 'OPENAI_KEY_MISSING';
    throw error;
  }

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
        content: [{ type: 'input_text', text: buildPrompt(snapshot) }],
      },
    ],
    temperature: 0.3,
    max_output_tokens: 120,
  };

  const timeoutMs = Number.parseInt(process.env.OPENAI_SUMMARY_TIMEOUT_MS || '2500', 10);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 2500);

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
      throw error;
    }
    const payload = await response.json();
    const text = normalizeSummary(extractResponseText(payload));
    if (!text) {
      const error = new Error('OpenAI summary response was empty');
      error.code = 'OPENAI_EMPTY_RESPONSE';
      throw error;
    }
    return text;
  } catch (error) {
    console.error('Pulse so-what summary generation failed:', error?.message || error);
    const wrapped = new Error('AI summary unavailable');
    wrapped.code = error?.code || 'OPENAI_SUMMARY_UNAVAILABLE';
    wrapped.cause = error;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}
