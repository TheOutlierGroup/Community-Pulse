import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInviteSubject, applyPromisedMinimumToInvite, applyInviteBranding } from './email.js';

test('a saved subject with a long dash separator sends with a colon', () => {
  assert.equal(normalizeInviteSubject('Rhythm Engine questionnaire — ZZ_TEST'), 'Rhythm Engine questionnaire: ZZ_TEST');
  assert.equal(normalizeInviteSubject('Rhythm Engine manager questionnaire – Acme'), 'Rhythm Engine manager questionnaire: Acme');
  assert.equal(normalizeInviteSubject('Plain subject'), 'Plain subject');
  assert.doesNotMatch(normalizeInviteSubject('A—B'), /—/);
});

test('invite states the promised minimum group size', () => {
  const body = 'once at least 5 people in your team and at least 5 managers have responded. Groups of 5 or more.';
  assert.equal(applyPromisedMinimumToInvite(body, 5), body);
  assert.equal(
    applyPromisedMinimumToInvite(body, 3),
    'once at least 3 people in your team and at least 3 managers have responded. Groups of 3 or more.'
  );
});

test('event mode button colour replaces the default orange', () => {
  const html = '<a style="display: inline-block; background: #ffcc80; color: #1c1917; font-weight: 600;">Open</a>';
  assert.match(applyInviteBranding(html, { buttonColor: '#023003', buttonTextColor: '#ffffff' }), /background: #023003; color: #ffffff;/);
  assert.equal(applyInviteBranding(html, {}), html);
});
