import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requireAdmin,
  requirePlatformAdminRole,
  requireAtLeastPlatformTier,
} from './auth.js';

/**
 * PT-11: pins the claim the corrected comment in apiKey.js now makes.
 *
 * The old comment asserted the /api/v1 surface was "read-only by
 * convention (no role -> requireAdmin will block writes)". requireAdmin
 * does not guard /api/v1 at all, so that reasoning was load-bearing and
 * false. What IS true is that `role: 'apikey'` is a non-role which
 * matches no branch of any role gate — so if an API key principal ever
 * reaches a human-facing admin route, it is refused rather than falling
 * into a tier by default.
 *
 * That property is what makes the surface safe to extend, so it is worth
 * a test rather than a comment.
 */

function apiKeyPrincipal() {
  return {
    id: 'apikey:key-1',
    role: 'apikey',
    organizationId: 'org-1',
    organizationKind: 'licensee',
    apiKeyId: 'key-1',
    // Generously assume a live MFA claim: the rejection must come from
    // the role being unrecognised, not from a missing MFA stamp.
    mfaVerifiedAt: new Date().toISOString(),
  };
}

function fakeRes() {
  const out = {};
  return {
    _out: out,
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(body) {
      out.body = body;
      return this;
    },
  };
}

const GATES = [
  ['requireAdmin', requireAdmin],
  ['requirePlatformAdminRole', requirePlatformAdminRole],
  ['requireAtLeastPlatformTier', requireAtLeastPlatformTier],
];

for (const [name, gate] of GATES) {
  test(`PT-11: ${name} refuses an API key principal`, () => {
    const req = { user: apiKeyPrincipal(), method: 'POST' };
    const res = fakeRes();
    let nexted = false;
    gate(req, res, () => {
      nexted = true;
    });
    assert.equal(nexted, false, `${name} must not admit an API key principal`);
    assert.equal(res._out.statusCode, 403);
  });
}

test('PT-11: the synthetic role is not one of the real platform roles', async () => {
  const { PLATFORM_ORG_ROLES } = await import('../models/User.js');
  assert.equal(
    PLATFORM_ORG_ROLES.includes('apikey'),
    false,
    'apikey must stay outside the real role set, or the gates above start admitting it'
  );
});
