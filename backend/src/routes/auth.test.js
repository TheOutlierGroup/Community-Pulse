import test from 'node:test';
import assert from 'node:assert/strict';
import { mfaVerifiedAtForHandoffExchange } from './auth.js';

// The CRM -> Rhythm Engine handoff exchange used to mint the new session
// token with no mfaVerifiedAt claim at all, so every admin who reached
// Rhythm Engine via the CRM's handoff redirect (the only normal path in)
// failed every MFA-gated admin action, regardless of their CRM session's
// actual verification state. See migration 085.

test('carries a fresh CRM-side verification across the handoff', () => {
  const verifiedAt = new Date().toISOString();
  const result = mfaVerifiedAtForHandoffExchange(
    { mfa_enabled: true },
    { mfa_verified_at: verifiedAt }
  );
  assert.equal(result, verifiedAt);
});

test('carries an absent CRM-side verification across as absent, not fabricated fresh', () => {
  const result = mfaVerifiedAtForHandoffExchange(
    { mfa_enabled: true },
    { mfa_verified_at: null }
  );
  assert.equal(result, null);
});

test('never carries a claim for an account with MFA currently disabled', () => {
  // Covers the account being disabled in the ~2-minute window between the
  // handoff link being issued and exchanged, even if the stored token row
  // still has an old mfa_verified_at value on it.
  const result = mfaVerifiedAtForHandoffExchange(
    { mfa_enabled: false },
    { mfa_verified_at: new Date().toISOString() }
  );
  assert.equal(result, null);
});

test('handles a missing consumed token row shape defensively', () => {
  assert.equal(mfaVerifiedAtForHandoffExchange({ mfa_enabled: true }, null), null);
  assert.equal(mfaVerifiedAtForHandoffExchange({ mfa_enabled: true }, {}), null);
});
