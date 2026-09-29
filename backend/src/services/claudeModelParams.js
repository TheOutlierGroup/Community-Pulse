// Request parameters that depend on which Claude model is configured.
//
// Claude Sonnet 5.5 rejects non-default sampling parameters (temperature) and runs adaptive
// thinking unless told otherwise, which would eat the small max_tokens / timeout budgets these
// short single-shot calls use. Older models (e.g. Sonnet 4) reject the `thinking` type used to
// turn it off. This keeps one call site valid for either model so the model can be switched
// through env vars alone.

const SONNET_5_5 = /^claude-sonnet-5-5/;
const CLAUDE_5_PLUS = /^claude-(sonnet|opus|fable|mythos)-5/;

export function claudeModelParams(model, { temperature } = {}) {
  const id = String(model || '');
  if (SONNET_5_5.test(id)) {
    return { thinking: { type: 'between_tools' } };
  }
  if (CLAUDE_5_PLUS.test(id) || temperature === undefined) {
    return {};
  }
  return { temperature };
}
