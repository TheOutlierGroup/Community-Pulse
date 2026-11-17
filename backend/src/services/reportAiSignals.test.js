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

test('G17: key findings never report a withheld manager cohort as 0%', async () => {
  const prevKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const data = buildReportData();
    data.manager.sample_size_met = false;
    data.manager.min_sample_size = 5;
    data.manager.load_distribution = data.manager.load_distribution.map((b) => ({ ...b, percent: null, count: null }));
    data.manager.sponsorship_chain_distribution = data.manager.sponsorship_chain_distribution.map((s) => ({ ...s, percent: null, count: null }));
    data.alerts = [];
    const out = await generateReportSignals(data);
    const text = out.keyFindings.join('\n');
    assert.doesNotMatch(text, /\d+% of managers/);
    assert.match(text, /withheld to keep responses confidential: fewer than 5 managers responded/);
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
  }
});

test('G17: key findings still report manager percentages above the floor', async () => {
  const prevKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const out = await generateReportSignals(buildReportData({ overloadedPercent: 12, failedChainPercent: 18 }));
    const text = out.keyFindings.join('\n');
    assert.match(text, /12% of managers are in the Overloaded load band/);
    assert.match(text, /18% of managers are in the failed sponsorship chain state/);
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
  }
});

test('G17: the team fallback does not count withheld teams as above threshold', async () => {
  const prevKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const data = buildReportData();
    data.teams = [
      { name: 'Alpha', sample_size_met: false, adoption_score: null, sponsorship_score: null, adoption_status: null, sponsorship_status: null },
      { name: 'Beta', sample_size_met: false, adoption_score: null, sponsorship_score: null, adoption_status: null, sponsorship_status: null },
    ];
    const out = await generateReportSignals(data);
    assert.doesNotMatch(out.teams, /sit above the 28\/40 readiness threshold/);
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
  }
});

test('H1: withheld teams are not sent to the AI commentary', async () => {
  const prevKey = process.env.ANTHROPIC_API_KEY;
  const prevFetch = global.fetch;
  const requests = [];
  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'Commentary.' }] }) };
  };
  try {
    const data = buildReportData();
    data.teams = [
      { name: 'Accounts', sample_size_met: false, response_count: 5, adoption_score: null, sponsorship_score: null },
      { name: 'Fleet', sample_size_met: true, response_count: 6, adoption_score: 31, sponsorship_score: 30, adoption_status: 'HIGH', sponsorship_status: 'HIGH' },
    ];
    await generateReportSignals(data);
    assert.ok(requests.length > 0);
    for (const body of requests) {
      const content = body.messages[0].content;
      assert.doesNotMatch(content, /Accounts/);
      assert.match(content, /Fleet/);
      assert.match(content, /"withheld_team_count": 1/);
      assert.match(body.system, /never name them/);
    }
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
    global.fetch = prevFetch;
  }
});
