import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPerceptionGapFlaggedItems,
  buildPerceptionGapFallbackNarrative,
  generatePulsePerceptionGapAnalysis,
  PERCEPTION_GAP_ANALYSIS_MIN_SAMPLES,
  PERCEPTION_GAP_ANALYSIS_THRESHOLD,
} from './pulsePerceptionGapAnalysis.js';

const dimensionsFixture = [
  {
    id: '1A',
    label: 'Competence & Capability',
    managerLabel: 'Enabling Team Competence',
    comparable: true,
    employee: { average: 2.2, q1Avg: 2.2, q2Avg: 2.2, count: 12 },
    manager: { average: 4.0, q1Avg: 4.0, q2Avg: 4.0, count: 8 },
    q1Construct: 'Skill support',
    q2Construct: 'Capacity to learn',
  },
  {
    id: '1B',
    label: 'Change Track Record',
    managerLabel: 'Team Change Track Record',
    comparable: true,
    employee: { average: 3.6, q1Avg: 3.5, q2Avg: 3.7, count: 12 },
    manager: { average: 3.8, q1Avg: 3.8, q2Avg: 3.8, count: 8 },
    q1Construct: 'Past changes stuck',
    q2Construct: 'Change delivered well',
  },
  {
    id: '1C',
    comparable: false,
    employee: { average: 1.0, count: 12 },
    manager: { average: 5.0, count: 8 },
  },
];

test('buildPerceptionGapFlaggedItems flags only comparable dimensions/questions at or above the threshold', () => {
  const items = buildPerceptionGapFlaggedItems({
    dimensions: dimensionsFixture,
    threshold: PERCEPTION_GAP_ANALYSIS_THRESHOLD,
  });
  const ids = items.map((item) => `${item.dimensionId}:${item.kind}:${item.questionPosition || 'dim'}`);
  assert.deepEqual(
    ids,
    ['1A:dimension:dim', '1A:question:q1', '1A:question:q2'],
    'expected only the 1A dimension + its two questions to flag (1B is below threshold, 1C is non-comparable)'
  );
  assert.ok(items[0].gap >= 1.5);
  assert.ok(items.every((item) => item.gap >= PERCEPTION_GAP_ANALYSIS_THRESHOLD));
});

test('buildPerceptionGapFallbackNarrative returns null when there are no items', () => {
  const text = buildPerceptionGapFallbackNarrative({ items: [], threshold: 1.5 });
  assert.equal(text, null);
});

test('buildPerceptionGapFallbackNarrative names the top items and includes direction', () => {
  const items = buildPerceptionGapFlaggedItems({
    dimensions: dimensionsFixture,
    threshold: 1.5,
  });
  const text = buildPerceptionGapFallbackNarrative({ items, threshold: 1.5 });
  assert.ok(text && text.length > 0, 'narrative should be a non-empty string');
  assert.match(text, /1A/);
  assert.match(text, /managers rate the experience more favourably than employees do/);
  assert.match(text, /manager.+employee conversation/i);
});

test('generatePulsePerceptionGapAnalysis suppresses output when sample size is below the gate', async () => {
  const result = await generatePulsePerceptionGapAnalysis({
    orgName: 'Acme',
    dimensions: dimensionsFixture,
    employeeCount: 1,
    managerCount: 1,
  });
  assert.equal(result.source, 'suppressed');
  assert.equal(result.sampleSizeMet, false);
  assert.equal(result.text, null);
  assert.equal(result.flagged.length, 0);
  assert.equal(result.minSampleSize, PERCEPTION_GAP_ANALYSIS_MIN_SAMPLES);
});

test('generatePulsePerceptionGapAnalysis returns no narrative when nothing flags', async () => {
  const calmDimensions = dimensionsFixture.map((dim) => ({
    ...dim,
    employee: { ...dim.employee, average: 3.5, q1Avg: 3.4, q2Avg: 3.6 },
    manager: { ...dim.manager, average: 3.6, q1Avg: 3.5, q2Avg: 3.7 },
  }));
  const result = await generatePulsePerceptionGapAnalysis({
    orgName: 'Acme',
    dimensions: calmDimensions,
    employeeCount: 12,
    managerCount: 8,
  });
  assert.equal(result.source, 'none');
  assert.equal(result.sampleSizeMet, true);
  assert.equal(result.text, null);
  assert.equal(result.flagged.length, 0);
});

test('generatePulsePerceptionGapAnalysis falls back to deterministic narrative when no AI key is configured', async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const result = await generatePulsePerceptionGapAnalysis({
      orgName: 'Acme',
      dimensions: dimensionsFixture,
      employeeCount: 12,
      managerCount: 8,
    });
    assert.equal(result.source, 'fallback');
    assert.equal(result.sampleSizeMet, true);
    assert.ok(result.text && result.text.length > 0, 'fallback narrative should be present');
    assert.ok(result.flagged.length >= 1);
  } finally {
    if (previousKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = previousKey;
    }
  }
});
