import test from 'node:test';
import assert from 'node:assert/strict';
import { generateReportSignals } from './reportAiSignals.js';

function buildReportData({
  adoption = 32,
  sponsorship = 24,
  overloadedPercent = 12,
  failedChainPercent = 18,
} = {}) {
  return {
    stage: 'pre',
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
    const out = await generateReportSignals(buildReportData(), { programme_name: 'Phoenix' });
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
