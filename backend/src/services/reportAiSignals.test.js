import test from 'node:test';
import assert from 'node:assert/strict';
import { generateReportSignals, enforceReportLanguage } from './reportAiSignals.js';

function buildReportData({
  stage = 'pre',
  adoption = 32,
  sponsorship = 24,
  overloadedPercent = 12,
  failedChainPercent = 18,
} = {}) {
  return {
    stage,
    org: { name: 'Client A' },
    readiness: {
      adoption_score: adoption,
      sponsorship_score: sponsorship,
      adoption_status: adoption >= 28 ? 'HIGH' : 'LOW',
      sponsorship_status: sponsorship >= 28 ? 'HIGH' : 'LOW',
    },
    dimensions: { employee: [], manager: [] },
    manager: {
      load_distribution: [
        { name: 'Sustainable', percent: 40 },
        { name: 'Stretched', percent: 30 },
        { name: 'At Capacity', percent: 100 - overloadedPercent - 70 },
        { name: 'Overloaded', percent: overloadedPercent },
      ],
      sponsorship_chain_distribution: [
        { name: 'Chain Functioning', percent: 42 },
        { name: 'Breaking at Manager Level', percent: 20 },
        { name: 'Managers Resilient, Under-Supported', percent: 20 },
        { name: 'Sponsorship Failed at Both Levels', percent: failedChainPercent },
      ],
    },
    alerts: [{ title: 'Manager Overload' }, { title: 'Dimension Floor' }],
  };
}

test('generateReportSignals returns deterministic fallback copy without Anthropic key', async () => {
  const prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = '';
  try {
    const out = await generateReportSignals(buildReportData(), { program_name: 'Phoenix' });
    assert.equal(typeof out.executive, 'string');
    assert.equal(typeof out.adoption, 'string');
    assert.equal(typeof out.sponsorship, 'string');
    assert.equal(typeof out.managerLoad, 'string');
    assert.equal(typeof out.chain, 'string');
    assert.equal(out.keyFindings.length, 5);
    assert.equal(out.nextStepsOrder[0], 'Sponsorship Architecture Review');
    assert.equal(out.nextStepsOrder[1], 'Change Portfolio Review');
  } finally {
    process.env.ANTHROPIC_API_KEY = prevKey;
  }
});

// EXE-05: "Australian English with no em dashes" is a hard requirement on
// the delivered report. The system prompt now instructs the model not to
// use one, but an instruction is not a guarantee -- this proves the
// belt-and-suspenders sanitisation strips one even when the model (or, as
// here, a stubbed response standing in for it) ignores that instruction.
test('generateReportSignals strips em dashes from AI-returned text even if the model ignores the style rule', async () => {
  const prevKey = process.env.ANTHROPIC_API_KEY;
  const prevFetch = global.fetch;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ type: 'text', text: 'Adoption is strong — sponsorship is the gap — intervene there first.' }],
    }),
  });
  try {
    const out = await generateReportSignals(buildReportData());
    for (const value of [out.executive, out.adoption, out.sponsorship, out.managerLoad, out.chain, out.teams]) {
      assert.doesNotMatch(value, /—/, `expected no em dash in: ${value}`);
    }
    assert.match(out.executive, /Adoption is strong – sponsorship is the gap – intervene there first\./);
  } finally {
    process.env.ANTHROPIC_API_KEY = prevKey;
    global.fetch = prevFetch;
  }
});

test('generateReportSignals falls back when AI API calls fail', async () => {
  const prevKey = process.env.ANTHROPIC_API_KEY;
  const prevFetch = global.fetch;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  try {
    const out = await generateReportSignals(buildReportData({ adoption: 24, sponsorship: 30 }));
    assert.match(out.executive, /Review the score cards/i);
    assert.equal(out.nextStepsOrder[0], 'Sponsorship Architecture Review');
    assert.ok(out.keyFindings.some((line) => /Adoption Readiness is 24\/40/i.test(line)));
  } finally {
    process.env.ANTHROPIC_API_KEY = prevKey;
    global.fetch = prevFetch;
  }
});

// RED-070: the FourTier Mid-Change report showed literal asterisks around
// headings, "pulse checks" / "Sponsorship Pulse", and "anonymity" wording.
test('enforceReportLanguage strips markdown and applies product language', () => {
  const out = enforceReportLanguage(
    '**Readiness verdict:** Not cleared.\n\n## Next steps\n* Run monthly pulse checks.\nThe Sponsorship Pulse is low. Respondent anonymity is protected and answers are anonymous.'
  );
  assert.doesNotMatch(out, /\*|#/);
  assert.doesNotMatch(out, /pulse/i);
  assert.doesNotMatch(out, /anonym/i);
  assert.match(out, /^Readiness verdict: Not cleared\.\n\nNext steps\nRun monthly check-ins\./);
  assert.match(out, /Sponsorship Credibility is low/);
  assert.match(out, /confidentiality is protected and answers are confidential\./);
});

test('RED-070: AI text is sanitised and the prompts carry the stage and language rules', async () => {
  const prevKey = process.env.ANTHROPIC_API_KEY;
  const prevFetch = global.fetch;
  const requests = [];
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: '**Overview** Schedule quarterly pulse checks to protect anonymity.' }],
      }),
    };
  };
  try {
    const out = await generateReportSignals(buildReportData({ stage: 'mid' }));
    for (const value of [out.executive, out.adoption, out.sponsorship, out.managerLoad, out.chain, out.teams]) {
      assert.doesNotMatch(value, /\*|pulse|anonym/i, `expected clean text in: ${value}`);
    }
    assert.ok(requests.length > 0);
    for (const body of requests) {
      assert.match(body.system, /Never use the word "pulse"/);
      assert.match(body.system, /confidential/);
      assert.match(body.system, /no markdown/);
      const data = body.messages[0].content;
      assert.match(data, /"stage": "mid"/);
      assert.match(data, /Mid-Change: a check-in taken while the program is already under way/);
      assert.doesNotMatch(data.split('DATA:')[0], /launch implication|launch timing|cleared for launch/i);
    }
    const executiveRequest = requests.find((body) => /executive summary/i.test(body.system));
    assert.match(executiveRequest.system, /whether delivery can continue at the current pace/);
  } finally {
    process.env.ANTHROPIC_API_KEY = prevKey;
    global.fetch = prevFetch;
  }
});
