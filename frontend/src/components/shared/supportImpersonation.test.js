import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exitSupportSessionUrl } from './supportImpersonation.js';

test('exitSupportSessionUrl returns the impersonated client dashboard when an org id was recorded', () => {
  assert.equal(exitSupportSessionUrl('org-123'), '/platform/clients/org-123');
});

test('exitSupportSessionUrl falls back to the platform dashboard when no org id was recorded', () => {
  assert.equal(exitSupportSessionUrl(null), '/platform');
  assert.equal(exitSupportSessionUrl(''), '/platform');
  assert.equal(exitSupportSessionUrl(undefined), '/platform');
});
