import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionRevoked } from './auth.js';

/**
 * PT-05 cover for the revocation predicate.
 *
 * requireAuth reads role, organizationId, organizationKind and
 * mfaVerifiedAt straight from a token that lives 7 days by default, so
 * without this check a demotion, org move, MFA change or password reset
 * left every issued token running on its original privileges until it
 * expired. The boundary that matters is the same-second case: a password
 * change stamps sessions_invalidated_at and immediately mints a
 * replacement token, and `iat` is whole seconds, so a naive comparison
 * logs the user straight back out.
 */

const SEC = 1000;
const iatFor = (date) => Math.floor(date.getTime() / SEC);

test('PT-05: no invalidation stamp means nothing is revoked', () => {
  assert.equal(sessionRevoked(null, iatFor(new Date())), false);
  assert.equal(sessionRevoked(undefined, iatFor(new Date())), false);
});

test('PT-05: a token issued before the stamp is revoked', () => {
  const invalidatedAt = new Date('2026-07-01T12:00:00.000Z');
  const issuedAt = iatFor(new Date('2026-07-01T11:00:00.000Z'));
  assert.equal(sessionRevoked(invalidatedAt, issuedAt), true);
});

test('PT-05: a token issued after the stamp survives', () => {
  const invalidatedAt = new Date('2026-07-01T12:00:00.000Z');
  const issuedAt = iatFor(new Date('2026-07-01T13:00:00.000Z'));
  assert.equal(sessionRevoked(invalidatedAt, issuedAt), false);
});

test('PT-05: the replacement token minted in the same second is NOT revoked', () => {
  // The ordinary flow: change password -> stamp -> mint new token. iat
  // floors to the start of that second, landing just before the stamp.
  // Without the grace window this logs the user out of the session they
  // just created.
  const invalidatedAt = new Date('2026-07-01T12:00:00.750Z');
  const issuedAt = iatFor(new Date('2026-07-01T12:00:00.800Z')); // -> 12:00:00
  assert.equal(sessionRevoked(invalidatedAt, issuedAt), false);
});

test('PT-05: a token from two seconds before the stamp is still revoked', () => {
  // The grace window must not widen into a usable gap.
  const invalidatedAt = new Date('2026-07-01T12:00:02.000Z');
  const issuedAt = iatFor(new Date('2026-07-01T12:00:00.000Z'));
  assert.equal(sessionRevoked(invalidatedAt, issuedAt), true);
});

test('PT-05: a token with no iat is treated as revoked', () => {
  const invalidatedAt = new Date('2026-07-01T12:00:00.000Z');
  assert.equal(sessionRevoked(invalidatedAt, undefined), true);
  assert.equal(sessionRevoked(invalidatedAt, NaN), true);
});

test('PT-05: an unparseable stamp does not lock everyone out', () => {
  // Fail open here specifically: a malformed column value must not
  // become a platform-wide outage. deactivated_at / login_enabled are
  // still enforced independently.
  assert.equal(sessionRevoked('not-a-date', iatFor(new Date())), false);
});

test('PT-05: accepts an ISO string stamp as returned by the driver', () => {
  const issuedAt = iatFor(new Date('2026-07-01T11:00:00.000Z'));
  assert.equal(sessionRevoked('2026-07-01T12:00:00.000Z', issuedAt), true);
});
