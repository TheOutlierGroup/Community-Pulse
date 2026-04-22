import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySponsorshipChainState,
  computeSurveyScores,
  getQuestionsForAudience,
  getSurveyCopyForAudience,
} from './pulseEngine.js';

function answersWith(prefix, values) {
  const out = {};
  values.forEach((value, idx) => {
    out[`${prefix}${idx + 1}`] = value;
  });
  return out;
}

function scoreStaff(values) {
  return computeSurveyScores({ audience: 'staff', answers: answersWith('Q', values) });
}

function scoreManager(values) {
  return computeSurveyScores({ audience: 'manager', answers: answersWith('MQ', values) });
}

test('employee scoring matrix (E-01..E-10 AUTO cases)', () => {
  const matrix = [
    {
      id: 'E-01',
      values: new Array(16).fill(5),
      adoption: 40,
      sponsorship: 40,
      quadrantCode: 'optimal',
    },
    {
      id: 'E-02',
      values: new Array(16).fill(1),
      adoption: 8,
      sponsorship: 8,
      quadrantCode: 'high_risk',
    },
    {
      id: 'E-03',
      values: [4, 4, 4, 4, 4, 4, 4, 4, 2, 2, 2, 2, 2, 2, 2, 2],
      adoption: 32,
      sponsorship: 16,
      quadrantCode: 'motivated_lost',
    },
    {
      id: 'E-04',
      values: [2, 2, 2, 2, 2, 2, 2, 2, 4, 4, 4, 4, 4, 4, 4, 4],
      adoption: 16,
      sponsorship: 32,
      quadrantCode: 'capable_wary',
    },
    {
      id: 'E-05',
      values: [4, 4, 4, 4, 3, 3, 3, 3, 4, 4, 4, 4, 3, 3, 3, 3],
      adoption: 28,
      sponsorship: 28,
      quadrantCode: 'optimal',
    },
    {
      id: 'E-06',
      values: [4, 4, 4, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4],
      adoption: 27,
      sponsorship: 32,
      quadrantCode: 'capable_wary',
    },
    {
      id: 'E-07',
      values: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3],
      adoption: 32,
      sponsorship: 27,
      quadrantCode: 'motivated_lost',
    },
    {
      id: 'E-09',
      values: [2, 3, 3, 2, 3, 3, 3, 3, 4, 4, 4, 4, 3, 4, 4, 3],
      adoption: 22,
      sponsorship: 30,
      quadrantCode: 'capable_wary',
    },
    {
      id: 'E-10',
      values: [4, 4, 4, 4, 4, 4, 4, 3, 3, 2, 3, 2, 2, 3, 2, 3],
      adoption: 31,
      sponsorship: 20,
      quadrantCode: 'motivated_lost',
    },
  ];

  for (const row of matrix) {
    const scored = scoreStaff(row.values);
    assert.equal(scored.valid, true, `${row.id} expected valid=true`);
    assert.equal(scored.adoption, row.adoption, `${row.id} adoption mismatch`);
    assert.equal(scored.sponsorship, row.sponsorship, `${row.id} sponsorship mismatch`);
    assert.equal(scored.quadrantCode, row.quadrantCode, `${row.id} quadrant mismatch`);
  }
});

test('manager scoring matrix (M-01..M-10 AUTO cases)', () => {
  const matrix = [
    {
      id: 'M-01',
      values: new Array(16).fill(5),
      adoption: 40,
      sponsorship: 40,
      quadrantCode: 'optimal',
      managerLoad: 20,
      managerLoadBand: 'Sustainable',
      chainState: 'Chain Functioning',
    },
    {
      id: 'M-02',
      values: new Array(16).fill(1),
      adoption: 8,
      sponsorship: 8,
      quadrantCode: 'high_risk',
      managerLoad: 4,
      managerLoadBand: 'Overloaded',
      chainState: 'Sponsorship Failed at Both Levels',
    },
    {
      id: 'M-03',
      values: [3, 3, 3, 3, 3, 3, 5, 5, 4, 4, 4, 4, 4, 3, 3, 4],
      adoption: 28,
      sponsorship: 30,
      quadrantCode: 'optimal',
      managerLoad: 13,
      managerLoadBand: 'Stretched',
      chainState: 'Chain Functioning',
    },
    {
      id: 'M-04',
      values: [5, 5, 5, 2, 2, 2, 1, 2, 4, 4, 4, 4, 3, 3, 2, 2],
      adoption: 24,
      sponsorship: 26,
      quadrantCode: 'high_risk',
      managerLoad: 8,
      managerLoadBand: 'At Capacity',
      chainState: 'Breaking at Manager Level',
    },
    {
      id: 'M-05',
      values: [3, 3, 3, 3, 1, 1, 3, 3, 3, 3, 3, 3, 3, 2, 1, 2],
      adoption: 20,
      sponsorship: 20,
      quadrantCode: 'high_risk',
      managerLoad: 5,
      managerLoadBand: 'Overloaded',
      chainState: 'Sponsorship Failed at Both Levels',
    },
    {
      id: 'M-06',
      values: [4, 4, 4, 4, 5, 5, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5],
      adoption: 35,
      sponsorship: 40,
      quadrantCode: 'optimal',
      managerLoad: 20,
      managerLoadBand: 'Sustainable',
      chainState: 'Chain Functioning',
    },
    {
      id: 'M-07',
      values: [5, 4, 4, 4, 2, 2, 4, 5, 4, 4, 4, 4, 4, 4, 2, 2],
      adoption: 30,
      sponsorship: 28,
      quadrantCode: 'optimal',
      managerLoad: 8,
      managerLoadBand: 'At Capacity',
      chainState: 'Breaking at Manager Level',
    },
    {
      id: 'M-08',
      values: [3, 3, 3, 3, 5, 5, 3, 3, 3, 3, 3, 3, 3, 3, 5, 5],
      adoption: 28,
      sponsorship: 28,
      quadrantCode: 'optimal',
      managerLoad: 20,
      managerLoadBand: 'Sustainable',
      chainState: 'Managers Resilient, Under-Supported',
    },
    {
      id: 'M-09',
      values: [3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
      adoption: 20,
      sponsorship: 16,
      quadrantCode: 'high_risk',
      managerLoad: 8,
      managerLoadBand: 'At Capacity',
      chainState: 'Sponsorship Failed at Both Levels',
    },
  ];

  for (const row of matrix) {
    const scored = scoreManager(row.values);
    assert.equal(scored.valid, true, `${row.id} expected valid=true`);
    assert.equal(scored.adoption, row.adoption, `${row.id} adoption mismatch`);
    assert.equal(scored.sponsorship, row.sponsorship, `${row.id} sponsorship mismatch`);
    assert.equal(scored.quadrantCode, row.quadrantCode, `${row.id} quadrant mismatch`);
    assert.equal(scored.managerLoad, row.managerLoad, `${row.id} managerLoad mismatch`);
    assert.equal(scored.managerLoadBand, row.managerLoadBand, `${row.id} load band mismatch`);
    assert.equal(scored.sponsorshipChainState, row.chainState, `${row.id} chain state mismatch`);
  }
});

test('E-08 and M-10 missing questions return validation errors', () => {
  const employeeMissing = scoreStaff(new Array(15).fill(3));
  assert.equal(employeeMissing.valid, false);
  assert.deepEqual(employeeMissing.unanswered, ['Q16']);

  const managerMissing = scoreManager(new Array(15).fill(3));
  assert.equal(managerMissing.valid, false);
  assert.deepEqual(managerMissing.unanswered, ['MQ16']);
});

test('invalid likert values are rejected as unanswered', () => {
  const withZero = scoreStaff([0, ...new Array(15).fill(3)]);
  assert.equal(withZero.valid, false);
  assert.deepEqual(withZero.unanswered, ['Q1']);

  const withSix = scoreStaff([6, ...new Array(15).fill(3)]);
  assert.equal(withSix.valid, false);
  assert.deepEqual(withSix.unanswered, ['Q1']);

  const withFloat = scoreStaff([2.5, ...new Array(15).fill(3)]);
  assert.equal(withFloat.valid, false);
  assert.deepEqual(withFloat.unanswered, ['Q1']);
});

test('SC-01..SC-04 readiness boundary classification is exact at 27/28', () => {
  const adoption28 = scoreStaff([4, 4, 4, 4, 3, 3, 3, 3, 5, 5, 5, 5, 5, 5, 5, 5]);
  assert.equal(adoption28.adoption, 28);
  assert.equal(adoption28.quadrantCode, 'optimal');

  const adoption27 = scoreStaff([4, 4, 4, 3, 3, 3, 3, 3, 5, 5, 5, 5, 5, 5, 5, 5]);
  assert.equal(adoption27.adoption, 27);
  assert.equal(adoption27.quadrantCode, 'capable_wary');

  const sponsor28 = scoreStaff([5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3]);
  assert.equal(sponsor28.sponsorship, 28);
  assert.equal(sponsor28.quadrantCode, 'optimal');

  const sponsor27 = scoreStaff([5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 3, 3, 3, 3, 3]);
  assert.equal(sponsor27.sponsorship, 27);
  assert.equal(sponsor27.quadrantCode, 'motivated_lost');
});

test('SC-05..SC-10 manager load boundaries map to correct bands', () => {
  const cases = [
    { targetLoad: 16, expected: 'Sustainable' },
    { targetLoad: 15, expected: 'Stretched' },
    { targetLoad: 11, expected: 'Stretched' },
    { targetLoad: 10, expected: 'At Capacity' },
    { targetLoad: 6, expected: 'At Capacity' },
    { targetLoad: 5, expected: 'Overloaded' },
  ];
  for (const { targetLoad, expected } of cases) {
    const values = new Array(16).fill(3);
    const seed = [4, 4, 4, 4];
    while (seed.reduce((sum, v) => sum + v, 0) > targetLoad) {
      for (let i = 3; i >= 0; i -= 1) {
        if (seed[i] > 1 && seed.reduce((sum, v) => sum + v, 0) > targetLoad) seed[i] -= 1;
      }
    }
    values[4] = seed[0];
    values[5] = seed[1];
    values[14] = seed[2];
    values[15] = seed[3];
    const scored = scoreManager(values);
    assert.equal(scored.managerLoad, targetLoad);
    assert.equal(scored.managerLoadBand, expected);
  }
});

test('SC-11..SC-14 sponsorship thresholds classify at 14 as HIGH and 13 as LOW', () => {
  assert.equal(classifySponsorshipChainState(14, 14), 'Chain Functioning');
  assert.equal(classifySponsorshipChainState(14, 13), 'Breaking at Manager Level');
  assert.equal(classifySponsorshipChainState(13, 14), 'Managers Resilient, Under-Supported');
  assert.equal(classifySponsorshipChainState(13, 13), 'Sponsorship Failed at Both Levels');
});

test('SC-15 + SC-16 dual-contribution questions count correctly without double-counting', () => {
  const values = [3, 3, 3, 3, 5, 1, 3, 3, 4, 4, 4, 4, 2, 2, 5, 1];
  const scored = scoreManager(values);
  const expectedLoad = values[4] + values[5] + values[14] + values[15];
  const expectedSponsor = values.slice(8).reduce((sum, value) => sum + value, 0);
  const expectedCapacity = values[12] + values[13] + values[14] + values[15];
  const expectedReceived = values[8] + values[9] + values[10] + values[11];

  assert.equal(scored.managerLoad, expectedLoad);
  assert.equal(scored.sponsorship, expectedSponsor);
  assert.equal(scored.sponsorshipCapacityScore, expectedCapacity);
  assert.equal(scored.sponsorshipReceivedScore, expectedReceived);
});

test('SC-17 + SC-18 dimensions include all 8 keys and 1A equals Q1+Q2', () => {
  const values = [5, 4, 3, 2, 4, 3, 2, 1, 5, 5, 4, 4, 3, 3, 2, 2];
  const scored = scoreStaff(values);
  assert.equal(scored.valid, true);
  assert.equal(scored.dimensions.length, 8);
  assert.deepEqual(
    scored.dimensions.map((d) => d.id),
    ['1A', '1B', '1C', '1D', '2A', '2B', '2C', '2D']
  );
  const dim1A = scored.dimensions.find((d) => d.id === '1A');
  assert.ok(dim1A);
  assert.equal(dim1A.score, values[0] + values[1]);
});

test('stage-specific question text changes by stage while ids remain stable', () => {
  const pre = getQuestionsForAudience('staff', 'pre');
  const mid = getQuestionsForAudience('staff', 'mid');
  const post = getQuestionsForAudience('staff', 'post');
  assert.equal(pre[0].id, mid[0].id);
  assert.equal(mid[0].id, post[0].id);
  assert.notEqual(pre[0].text, mid[0].text);
  assert.notEqual(mid[0].text, post[0].text);
});

test('survey copy payload is stage and audience aware', () => {
  const employeeMid = getSurveyCopyForAudience('staff', 'mid');
  const managerPost = getSurveyCopyForAudience('manager', 'post');
  assert.equal(employeeMid.stage, 'mid');
  assert.equal(employeeMid.audience, 'staff');
  assert.equal(managerPost.stage, 'post');
  assert.equal(managerPost.audience, 'manager');
  assert.notEqual(employeeMid.intro, managerPost.intro);
});

test('scoring parity holds across stages for same answers', () => {
  const answers = answersWith('Q', new Array(16).fill(4));
  const pre = computeSurveyScores({ audience: 'staff', stage: 'pre', answers });
  const mid = computeSurveyScores({ audience: 'staff', stage: 'mid', answers });
  const post = computeSurveyScores({ audience: 'staff', stage: 'post', answers });
  assert.equal(pre.adoption, mid.adoption);
  assert.equal(mid.adoption, post.adoption);
  assert.equal(pre.sponsorship, mid.sponsorship);
  assert.equal(mid.sponsorship, post.sponsorship);
});
