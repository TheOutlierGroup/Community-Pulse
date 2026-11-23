import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSurveyScores, scoreBandForManagerLoad } from './pulseEngine.js';

// Study Reference Guide 4.3: Manager Load = MQ5 + MQ6 + MQ15 + MQ16 (4-20).
// Green Room retest (23 Nov 2026): the dashboard used MQ15 + MQ16 only, so
// Bran (strain in MQ5/MQ6) showed Sustainable instead of Stretched.
function managerAnswers({ mq5, mq6, mq15, mq16 }) {
  const answers = {};
  for (let i = 1; i <= 16; i += 1) answers[`MQ${i}`] = 3;
  Object.assign(answers, { MQ5: mq5, MQ6: mq6, MQ15: mq15, MQ16: mq16 });
  return answers;
}

const GREEN_ROOM = [
  ['Mash', { mq5: 4, mq6: 4, mq15: 4, mq16: 4 }, 16, 'Sustainable'],
  ['Del', { mq5: 4, mq6: 4, mq15: 3, mq16: 3 }, 14, 'Stretched'],
  ['Bran', { mq5: 3, mq6: 3, mq15: 4, mq16: 4 }, 14, 'Stretched'],
  ['Ford', { mq5: 2, mq6: 2, mq15: 2, mq16: 2 }, 8, 'At Capacity'],
  ['Owen', { mq5: 1, mq6: 1, mq15: 1, mq16: 1 }, 4, 'Overloaded'],
];

for (const [name, parts, total, band] of GREEN_ROOM) {
  test(`${name}: Manager Load ${total} is ${band}`, () => {
    const scored = computeSurveyScores({ audience: 'manager', answers: managerAnswers(parts) });
    assert.equal(scored.managerLoad, total);
    assert.equal(scored.managerLoadBand, band);
    assert.equal(scored.sponsorshipLoadBand, band, 'no second, two-question band');
  });
}

test('Green Room split is 20% Sustainable, 40% Stretched, 20% At Capacity, 20% Overloaded', () => {
  const bands = GREEN_ROOM.map(([, parts]) =>
    computeSurveyScores({ audience: 'manager', answers: managerAnswers(parts) }).managerLoadBand
  );
  const share = (b) => (bands.filter((x) => x === b).length / bands.length) * 100;
  assert.deepEqual(
    ['Sustainable', 'Stretched', 'At Capacity', 'Overloaded'].map(share),
    [20, 40, 20, 20]
  );
});

test('band edges follow the guide (16 / 11 / 6)', () => {
  assert.equal(scoreBandForManagerLoad(20), 'Sustainable');
  assert.equal(scoreBandForManagerLoad(16), 'Sustainable');
  assert.equal(scoreBandForManagerLoad(15), 'Stretched');
  assert.equal(scoreBandForManagerLoad(11), 'Stretched');
  assert.equal(scoreBandForManagerLoad(10), 'At Capacity');
  assert.equal(scoreBandForManagerLoad(6), 'At Capacity');
  assert.equal(scoreBandForManagerLoad(5), 'Overloaded');
  assert.equal(scoreBandForManagerLoad(4), 'Overloaded');
});
