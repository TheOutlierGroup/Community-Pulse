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
const platformTierUser = { id: 'u-pt', role: 'platform', organizationId: 'p-1' };
const basicTierUser = { id: 'u-bt', role: 'basic', organizationId: 'p-1' };
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

test('Platform-tier user gets unrestricted client access, like admin — including licensee orgs', () => {
  // Regression: a real rollout hit "Client not found" for a Platform-tier
  // user because this function used to only special-case role === 'admin'
  // and fell through to the assignment/task-stake check for everyone else
  // — including the new Platform tier, which per spec should see every
  // client without needing an explicit assignment. Licensee orgs are
  // included too, matching GET /organizations (orgRoutes.js), which already
  // returns clients AND licensees to both admin and platform tier via
  // listClientAndLicenseeOrganizations — refusing licensees here would
  // recreate the same "visible in the list, 404 on open" bug.
  for (const target of [clientOfA, clientOfB, platformDirectClient, licenseeOrgA]) {
    assert.equal(
      canPlatformUserAccessClientOrgPure({
        user: platformTierUser,
        requesterOrg: platformOrg,
        targetOrg: target,
      }),
      true,
      `platform tier should access ${target.id}`
    );
  }
});

test('Basic-tier user needs assignment, task stake, OR Business Unit visibility for a client', () => {
  assert.equal(
    canPlatformUserAccessClientOrgPure({
      user: basicTierUser,
      requesterOrg: platformOrg,
      targetOrg: clientOfA,
    }),
    false
  );
  assert.equal(
    canPlatformUserAccessClientOrgPure({
      user: basicTierUser,
      requesterOrg: platformOrg,
      targetOrg: clientOfA,
      businessUnitVisible: true,
    }),
    true
  );
  assert.equal(
    canPlatformUserAccessClientOrgPure({
      user: basicTierUser,
      requesterOrg: platformOrg,
      targetOrg: licenseeOrgA,
      businessUnitVisible: true,
    }),
    false,
    'BU visibility never grants access to a licensee org'
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

// Enterprise self-service: a client org's own admin/employee may reach only
// their own org, and only when the Enterprise portal tier is enabled.
const enterpriseClient = {
  id: 'client-ent',
  kind: 'client',
  parent_organization_id: null,
  settings: { clientPortalTier: 'enterprise' },
};
const standardClient = {
  id: 'client-std',
  kind: 'client',
  parent_organization_id: null,
  settings: {},
};
const enterpriseClientAdmin = { id: 'u-ec', role: 'admin', organizationId: 'client-ent' };
const standardClientAdmin = { id: 'u-sc', role: 'admin', organizationId: 'client-std' };

test('Enterprise-tier client admin can access their own org', () => {
  assert.equal(
    canPlatformUserAccessClientOrgPure({
      user: enterpriseClientAdmin,
      requesterOrg: enterpriseClient,
      targetOrg: enterpriseClient,
    }),
    true
  );
});

test('Standard-tier client admin cannot access their own org via this helper (no Enterprise portal tier)', () => {
  assert.equal(
    canPlatformUserAccessClientOrgPure({
      user: standardClientAdmin,
      requesterOrg: standardClient,
      targetOrg: standardClient,
    }),
    false
  );
});

test('Enterprise-tier client admin cannot access a different client org', () => {
  assert.equal(
    canPlatformUserAccessClientOrgPure({
      user: enterpriseClientAdmin,
      requesterOrg: enterpriseClient,
      targetOrg: clientOfA,
    }),
    false
  );
});

test('Enterprise-tier client admin cannot access a licensee org', () => {
  assert.equal(
    canPlatformUserAccessClientOrgPure({
      user: enterpriseClientAdmin,
      requesterOrg: enterpriseClient,
      targetOrg: licenseeOrgA,
    }),
    false
  );
});
