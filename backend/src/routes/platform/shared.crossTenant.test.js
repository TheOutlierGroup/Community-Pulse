import test from 'node:test';
import assert from 'node:assert/strict';
import { canPlatformUserAccessClientOrgPure } from './shared.js';

const platformOrg = { id: 'p-1', kind: 'platform', parent_organization_id: null };
const licenseeOrgA = { id: 'lic-A', kind: 'licensee', parent_organization_id: null };
const licenseeOrgB = { id: 'lic-B', kind: 'licensee', parent_organization_id: null };
const clientOfA = { id: 'client-A1', kind: 'client', parent_organization_id: 'lic-A' };
const clientOfB = { id: 'client-B1', kind: 'client', parent_organization_id: 'lic-B' };
const platformDirectClient = { id: 'client-direct', kind: 'client', parent_organization_id: null };

const platformAdmin = { id: 'u-pa', role: 'admin', organizationId: 'p-1' };
const platformConsultant = { id: 'u-pc', role: 'employee', organizationId: 'p-1' };
const licenseeAdminA = { id: 'u-la', role: 'admin', organizationId: 'lic-A' };
const licenseeAdminB = { id: 'u-lb', role: 'admin', organizationId: 'lic-B' };

test('platform admin can access any client org', () => {
  for (const target of [clientOfA, clientOfB, platformDirectClient, licenseeOrgA]) {
    assert.equal(
      canPlatformUserAccessClientOrgPure({
        user: platformAdmin,
        requesterOrg: platformOrg,
        targetOrg: target,
      }),
      true,
      `admin should access ${target.id}`
    );
  }
});

test('platform non-admin cannot access licensee orgs even with an assignment flag', () => {
  assert.equal(
    canPlatformUserAccessClientOrgPure({
      user: platformConsultant,
      requesterOrg: platformOrg,
      targetOrg: licenseeOrgA,
      hasAssignment: true,
    }),
    false
  );
});

test('platform non-admin needs assignment OR task stake for a client', () => {
  const noSignal = canPlatformUserAccessClientOrgPure({
    user: platformConsultant,
    requesterOrg: platformOrg,
    targetOrg: clientOfA,
  });
  assert.equal(noSignal, false);

  assert.equal(
    canPlatformUserAccessClientOrgPure({
      user: platformConsultant,
      requesterOrg: platformOrg,
      targetOrg: clientOfA,
      hasAssignment: true,
    }),
    true
  );

  assert.equal(
    canPlatformUserAccessClientOrgPure({
      user: platformConsultant,
      requesterOrg: platformOrg,
      targetOrg: clientOfA,
      hasTaskStake: true,
    }),
    true
  );
});

test('licensee admin can access ONLY their own downstream clients', () => {
  assert.equal(
    canPlatformUserAccessClientOrgPure({
      user: licenseeAdminA,
      requesterOrg: licenseeOrgA,
      targetOrg: clientOfA,
    }),
    true,
    'A admin should access A client'
  );
  assert.equal(
    canPlatformUserAccessClientOrgPure({
      user: licenseeAdminA,
      requesterOrg: licenseeOrgA,
      targetOrg: clientOfB,
    }),
    false,
    'A admin must not access B client'
  );
});

test('licensee admin cannot access another licensee org', () => {
  assert.equal(
    canPlatformUserAccessClientOrgPure({
      user: licenseeAdminA,
      requesterOrg: licenseeOrgA,
      targetOrg: licenseeOrgB,
    }),
    false
  );
});

test('licensee admin cannot access their *own* org via this helper (it is for client/licensee targets only and licensee→licensee is blocked)', () => {
  assert.equal(
    canPlatformUserAccessClientOrgPure({
      user: licenseeAdminA,
      requesterOrg: licenseeOrgA,
      targetOrg: licenseeOrgA,
    }),
    false
  );
});

test('licensee admin cannot access platform-direct clients (no parent)', () => {
  assert.equal(
    canPlatformUserAccessClientOrgPure({
      user: licenseeAdminB,
      requesterOrg: licenseeOrgB,
      targetOrg: platformDirectClient,
    }),
    false
  );
});

test('non-platform/non-licensee orgs are denied as requester', () => {
  assert.equal(
    canPlatformUserAccessClientOrgPure({
      user: { id: 'u-c', role: 'admin', organizationId: 'client-A1' },
      requesterOrg: { id: 'client-A1', kind: 'client' },
      targetOrg: clientOfB,
    }),
    false
  );
});

test('non-client/non-licensee target is denied even for platform admin', () => {
  assert.equal(
    canPlatformUserAccessClientOrgPure({
      user: platformAdmin,
      requesterOrg: platformOrg,
      targetOrg: { id: 'p-2', kind: 'platform' },
    }),
    false
  );
});

test('null inputs are denied', () => {
  assert.equal(canPlatformUserAccessClientOrgPure({}), false);
  assert.equal(canPlatformUserAccessClientOrgPure({ user: platformAdmin }), false);
  assert.equal(
    canPlatformUserAccessClientOrgPure({ user: platformAdmin, requesterOrg: platformOrg }),
    false
  );
});
