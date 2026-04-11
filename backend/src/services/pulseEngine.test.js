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

test('boundary score of exactly 28 is classified HIGH — not below threshold', () => {
  // Q1-Q8 sum to exactly 28: 4,4,4,4,3,3,3,3 = 28. Sponsorship all 5s = 40.
  const answers = answersWith('Q', [4, 4, 4, 4, 3, 3, 3, 3, 5, 5, 5, 5, 5, 5, 5, 5]);
  const scored = computeSurveyScores({ audience: 'staff', answers });
  assert.equal(scored.adoption, 28);
  assert.equal(scored.quadrantCode, 'optimal');
});

test('score of 27 is classified LOW — one point below threshold', () => {
  // Q1-Q8 sum to 27: 4,4,4,3,3,3,3,3 = 27. Sponsorship all 5s = 40.
  const answers = answersWith('Q', [4, 4, 4, 3, 3, 3, 3, 3, 5, 5, 5, 5, 5, 5, 5, 5]);
  const scored = computeSurveyScores({ audience: 'staff', answers });
  assert.equal(scored.adoption, 27);
  assert.equal(scored.quadrantCode, 'capable_wary');
});

test('load questions isolated to 1,1,1,1 give load_score=4 and overloaded band', () => {
  // Doc §8 item 9 — explicit test case. Other questions mid-range (3) so adoption/sponsorship
  // are not all-min, isolating the load band calculation.
  const answers = answersWith('MQ', new Array(16).fill(3));
  answers.MQ5 = 1;
  answers.MQ6 = 1;
  answers.MQ15 = 1;
  answers.MQ16 = 1;
  const scored = computeSurveyScores({ audience: 'manager', answers });
  assert.equal(scored.managerLoad, 4);
  assert.equal(scored.managerLoadBand, 'Overloaded');
});

test('load band boundaries are correct for stretched and at_capacity', () => {
  // stretched: load_score 11–15
  const answersStretched = answersWith('MQ', new Array(16).fill(3));
  answersStretched.MQ5 = 3;
  answersStretched.MQ6 = 3;
  answersStretched.MQ15 = 3;
  answersStretched.MQ16 = 3; // load = 12
  const scoredStretched = computeSurveyScores({ audience: 'manager', answers: answersStretched });
  assert.equal(scoredStretched.managerLoad, 12);
  assert.equal(scoredStretched.managerLoadBand, 'Stretched');

  // at_capacity: load_score 6–10
  const answersAtCap = answersWith('MQ', new Array(16).fill(3));
  answersAtCap.MQ5 = 2;
  answersAtCap.MQ6 = 2;
  answersAtCap.MQ15 = 2;
  answersAtCap.MQ16 = 2; // load = 8
  const scoredAtCap = computeSurveyScores({ audience: 'manager', answers: answersAtCap });
  assert.equal(scoredAtCap.managerLoad, 8);
  assert.equal(scoredAtCap.managerLoadBand, 'At Capacity');
});
