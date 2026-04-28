import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMfaSecret, generateTotpCode, verifyTotpCode } from './mfa.js';

test('generateMfaSecret returns a hex secret', () => {
  const secret = generateMfaSecret();
  assert.match(secret, /^[a-f0-9]{40}$/);
});

test('verifyTotpCode accepts current timestep and rejects invalid codes', () => {
  const secret = '0123456789abcdef0123456789abcdef01234567';
  const atMs = Date.UTC(2026, 0, 1, 0, 0, 0);
  const code = generateTotpCode(secret, { atMs });
  assert.equal(verifyTotpCode(code, secret, { atMs }), true);
  assert.equal(verifyTotpCode('000000', secret, { atMs }), false);
});
