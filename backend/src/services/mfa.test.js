import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTotpUri,
  consumeRecoveryCode,
  generateMfaSecret,
  generateRecoveryCodes,
  generateTotpCode,
  verifyTotpCode,
} from './mfa.js';

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

test('buildTotpUri includes issuer, account, and base32 secret', () => {
  const secret = '0123456789abcdef0123456789abcdef01234567';
  const uri = buildTotpUri(secret, { email: 'admin@example.com', issuer: 'Employee Pulse' });
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /issuer=Employee\+Pulse/);
  assert.match(uri, /admin%40example\.com/);
  assert.match(uri, /secret=AERUKZ4JVPG66AJDIVTYTK6N54ASGRLH/);
});

test('buildTotpUri falls back to the product issuer, not the old internal name', () => {
  const previous = process.env.MFA_ISSUER;
  delete process.env.MFA_ISSUER;
  try {
    const uri = buildTotpUri('0123456789abcdef0123456789abcdef01234567', { email: 'admin@example.com' });
    assert.match(uri, /issuer=Outlier\+Pulse/);
    assert.doesNotMatch(uri, /Employee\+Pulse/);
  } finally {
    if (previous === undefined) delete process.env.MFA_ISSUER;
    else process.env.MFA_ISSUER = previous;
  }
});

test('recovery code can be consumed exactly once', () => {
  const { codes, codeHashes } = generateRecoveryCodes(2);
  const firstCode = codes[0];
  const once = consumeRecoveryCode(firstCode.toLowerCase(), codeHashes);
  assert.equal(once.consumed, true);
  assert.equal(once.remainingCodeHashes.length, 1);
  const twice = consumeRecoveryCode(firstCode, once.remainingCodeHashes);
  assert.equal(twice.consumed, false);
  assert.equal(twice.remainingCodeHashes.length, 1);
});
