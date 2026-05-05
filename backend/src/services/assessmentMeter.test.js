import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveRespondentCapForSession } from './assessmentMeter.js';

test('effectiveRespondentCapForSession returns null when no session', async () => {
  assert.equal(await effectiveRespondentCapForSession(null), null);
});

test('effectiveRespondentCapForSession prefers per-session override over licence cap', async () => {
  const session = { id: 's1', respondent_cap_override: 75 };
  const cap = await effectiveRespondentCapForSession(session, {
    licenseConfig: { respondent_cap_per_assessment: 50 },
  });
  assert.equal(cap, 75);
});

test('effectiveRespondentCapForSession respects override of 0 (closed)', async () => {
  const session = { id: 's2', respondent_cap_override: 0 };
  const cap = await effectiveRespondentCapForSession(session, {
    licenseConfig: { respondent_cap_per_assessment: 50 },
  });
  assert.equal(cap, 0);
});

test('effectiveRespondentCapForSession falls back to licence cap when no override', async () => {
  const session = { id: 's3', respondent_cap_override: null };
  const cap = await effectiveRespondentCapForSession(session, {
    licenseConfig: { respondent_cap_per_assessment: 50 },
  });
  assert.equal(cap, 50);
});

test('effectiveRespondentCapForSession returns null when no override and licence cap is null', async () => {
  const session = { id: 's4', respondent_cap_override: null };
  const cap = await effectiveRespondentCapForSession(session, {
    licenseConfig: { respondent_cap_per_assessment: null },
  });
  assert.equal(cap, null);
});

test('effectiveRespondentCapForSession returns null when no override and no licence config', async () => {
  const session = { id: 's5', respondent_cap_override: null };
  const cap = await effectiveRespondentCapForSession(session, {
    licenseConfig: null,
  });
  assert.equal(cap, null);
});
