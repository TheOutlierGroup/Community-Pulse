import test from 'node:test';
import assert from 'node:assert/strict';
import { hashInviteToken } from './inviteToken.js';

test('hashInviteToken is deterministic for same input', () => {
  const token = '2f3e7337-df23-45a7-a88d-12a83fdcb8f3';
  const a = hashInviteToken(token);
  const b = hashInviteToken(token);
  assert.equal(a, b);
});

test('hashInviteToken does not return the raw token', () => {
  const token = '2f3e7337-df23-45a7-a88d-12a83fdcb8f3';
  const hash = hashInviteToken(token);
  assert.notEqual(hash, token);
  assert.ok(hash.startsWith('v0:') || hash.startsWith('v1:'));
});
