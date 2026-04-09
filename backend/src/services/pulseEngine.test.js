import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSurveyScores } from './pulseEngine.js';

function answersWith(prefix, values) {
  const out = {};
  values.forEach((value, idx) => {
    out[`${prefix}${idx + 1}`] = value;
  });
  return out;
}

test('staff scoring uses 8+8 split and quadrant threshold', () => {
  const answers = answersWith('Q', new Array(16).fill(5));
  const scored = computeSurveyScores({ audience: 'staff', answers });
  assert.equal(scored.valid, true);
  assert.equal(scored.adoption, 40);
  assert.equal(scored.sponsorship, 40);
  assert.equal(scored.quadrantCode, 'optimal');
  assert.equal(scored.managerLoad, null);
  assert.equal(scored.dimensions.length, 8);
  assert.equal(scored.dimensions[0].score, 10);
});

test('manager scoring includes manager load and banding', () => {
  const answers = answersWith('MQ', new Array(16).fill(1));
  const scored = computeSurveyScores({ audience: 'manager', answers });
  assert.equal(scored.valid, true);
  assert.equal(scored.adoption, 8);
  assert.equal(scored.sponsorship, 8);
  assert.equal(scored.quadrantCode, 'high_risk');
  assert.equal(scored.managerLoad, 4);
  assert.equal(scored.managerLoadBand, 'Overloaded');
});

test('manager load band boundaries follow doc mapping', () => {
  const answers = answersWith('MQ', new Array(16).fill(3));
  answers.MQ5 = 4;
  answers.MQ6 = 4;
  answers.MQ15 = 4;
  answers.MQ16 = 4;
  const scored = computeSurveyScores({ audience: 'manager', answers });
  assert.equal(scored.managerLoad, 16);
  assert.equal(scored.managerLoadBand, 'Sustainable');
});

test('incomplete response returns unanswered ids', () => {
  const answers = answersWith('Q', new Array(15).fill(3));
  const scored = computeSurveyScores({ audience: 'staff', answers });
  assert.equal(scored.valid, false);
  assert.deepEqual(scored.unanswered, ['Q16']);
});
