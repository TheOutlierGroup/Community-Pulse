import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePulseTrendSignals, WITHHELD_MANAGER_LINE } from './pulseTrendSignals.js';

// RED-064 follow-up: with the manager cohort withheld, the fallback
// commentary read missing values as 0 ("Chain Functioning is 0%",
// "Overloaded band remains below critical threshold").
test('withheld manager data is never described as 0 in trend commentary', async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = '';
  try {
    const result = await generatePulseTrendSignals({
      orgName: 'Test',
      selectedTimepoint: 'pre',
      stages: [
        {
          key: 'pre', label: 'Pre', available: true, adoptionScore: 26.7, sponsorshipScore: 26.7, quadrant: 'High Risk',
          receivedAvg: null, capacityAvg: null, loadBands: {}, chainStates: {},
          dimensions: { employee: {}, manager: {} }, perceptionGap: null, managerCohortWithheld: true,
        },
        { key: 'during', label: 'During', available: false, loadBands: {}, chainStates: {}, dimensions: { employee: {}, manager: {} } },
      ],
    });
    const text = Object.values(result.signals).filter(Boolean).join(' ');
    assert.doesNotMatch(text, /0%|below critical threshold|tighter constraint|not overestimating|is available across/);
    assert.ok(result.signals.section4.includes(WITHHELD_MANAGER_LINE));
    assert.ok(result.signals.section7.includes(WITHHELD_MANAGER_LINE));
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  }
});
