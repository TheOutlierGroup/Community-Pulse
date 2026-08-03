import test from 'node:test';
import assert from 'node:assert/strict';
import { canCreateClientOrganization } from './orgRoutes.js';

// UAT D-004 / OGT-06: promoting a won prospect creates the client through
// the same route as the standalone New Client button, so an admin-only
// gate there also blocked Platform tier from promoting their own
// opportunity.
test('platform-org Platform tier can create a client, so it can promote a prospect', () => {
  assert.equal(canCreateClientOrganization('platform', 'platform'), true);
  assert.equal(canCreateClientOrganization('platform', 'admin'), true);
});

test('basic tier and unknown roles still cannot create clients', () => {
  assert.equal(canCreateClientOrganization('platform', 'basic'), false);
  assert.equal(canCreateClientOrganization('platform', 'employee'), false);
  assert.equal(canCreateClientOrganization('platform', undefined), false);
});

test('licensee callers are unchanged at admin-only', () => {
  assert.equal(canCreateClientOrganization('licensee', 'admin'), true);
  assert.equal(canCreateClientOrganization('licensee', 'platform'), false);
  assert.equal(canCreateClientOrganization('licensee', 'employee'), false);
});
