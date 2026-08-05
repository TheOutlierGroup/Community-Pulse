import test from 'node:test';
import assert from 'node:assert/strict';
import { createResolveReportOrganizationForUser } from './reportAuth.js';

test('report auth returns 404 when caller organization cannot be resolved', async (t) => {
  const resolveReportOrganizationForUser = createResolveReportOrganizationForUser({
    organizationModel: {
      async getOrganization() {
        return null;
      },
    },
    assignmentModel: {},
  });
  const out = await resolveReportOrganizationForUser({
    user: { id: 'u1', role: 'admin', organizationId: 'org-missing' },
  });
  assert.equal(out.ok, false);
  assert.equal(out.status, 404);
  assert.equal(out.error, 'ORG_NOT_FOUND');
});

test('client non-admin cannot generate consultant report', async (t) => {
  const resolveReportOrganizationForUser = createResolveReportOrganizationForUser({
    organizationModel: {
      async getOrganization() {
        return {
          id: 'org-client',
          kind: 'client',
          slug: 'client-a',
          settings: { services: ['pulse'] },
        };
      },
    },
    assignmentModel: {},
  });

  const out = await resolveReportOrganizationForUser({
    user: { id: 'u1', role: 'employee', organizationId: 'org-client' },
  });

  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
  assert.equal(out.error, 'GENERATION_FAILED');
});

test('client admin cannot request different org slug', async (t) => {
  const resolveReportOrganizationForUser = createResolveReportOrganizationForUser({
    organizationModel: {
      async getOrganization() {
        return {
          id: 'org-client',
          kind: 'client',
          slug: 'client-a',
          settings: { services: ['pulse'] },
        };
      },
    },
    assignmentModel: {},
  });

  const out = await resolveReportOrganizationForUser({
    user: { id: 'u1', role: 'admin', organizationId: 'org-client' },
    requestedOrgSlug: 'client-b',
  });

  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
  assert.equal(out.error, 'ORG_NOT_FOUND');
});

test('platform non-admin must be assigned to client organization', async (t) => {
  let isAssigned = false;
  const resolveReportOrganizationForUser = createResolveReportOrganizationForUser({
    organizationModel: {
      async getOrganization(id) {
        if (id === 'org-platform') return { id, kind: 'platform', settings: {} };
        return null;
      },
      async getOrganizationBySlug() {
        return {
          id: 'org-client',
          kind: 'client',
          slug: 'client-a',
          settings: { services: ['pulse'] },
        };
      },
    },
    assignmentModel: {
      async userHasClientOrgAssignment() {
        return isAssigned;
      },
    },
    userModel: {
      async getBusinessUnitsForUser() {
        return [];
      },
    },
  });

  const denied = await resolveReportOrganizationForUser({
    user: { id: 'u1', role: 'employee', organizationId: 'org-platform' },
    requestedOrgSlug: 'client-a',
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
  assert.equal(denied.error, 'ORG_NOT_FOUND');

  isAssigned = true;
  const allowed = await resolveReportOrganizationForUser({
    user: { id: 'u1', role: 'employee', organizationId: 'org-platform' },
    requestedOrgSlug: 'client-a',
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.organization.id, 'org-client');
});

// D-008 (REA-02 notes): "Not assigned to the organisation" blocked a
// Basic-tier user from generating a report for a client they could
// already see everywhere else in the app (Clients, Prospects, Contacts).
// This checked only the legacy per-user direct-assignment table, never
// the Business Unit tag scoping every other Basic-tier surface uses.
test('basic-tier user with a matching Business Unit tag can generate a report without a legacy assignment', async () => {
  const resolveReportOrganizationForUser = createResolveReportOrganizationForUser({
    organizationModel: {
      async getOrganization(id) {
        if (id === 'org-platform') return { id, kind: 'platform', settings: {} };
        return null;
      },
      async getOrganizationBySlug() {
        return {
          id: 'org-client',
          kind: 'client',
          slug: 'client-a',
          settings: { services: ['pulse'] }, // pulse -> Rhythm Engine
        };
      },
    },
    assignmentModel: {
      async userHasClientOrgAssignment() {
        return false;
      },
    },
    userModel: {
      async getBusinessUnitsForUser() {
        return ['Rhythm Engine'];
      },
    },
  });

  const out = await resolveReportOrganizationForUser({
    user: { id: 'u1', role: 'basic', organizationId: 'org-platform' },
    requestedOrgSlug: 'client-a',
  });
  assert.equal(out.ok, true);
  assert.equal(out.organization.id, 'org-client');
});

test('basic-tier user with no matching Business Unit tag and no legacy assignment is still denied', async () => {
  const resolveReportOrganizationForUser = createResolveReportOrganizationForUser({
    organizationModel: {
      async getOrganization(id) {
        if (id === 'org-platform') return { id, kind: 'platform', settings: {} };
        return null;
      },
      async getOrganizationBySlug() {
        return {
          id: 'org-client',
          kind: 'client',
          slug: 'client-a',
          settings: { services: ['pulse'] },
        };
      },
    },
    assignmentModel: {
      async userHasClientOrgAssignment() {
        return false;
      },
    },
    userModel: {
      async getBusinessUnitsForUser() {
        return ['Outlier Skate'];
      },
    },
  });

  const out = await resolveReportOrganizationForUser({
    user: { id: 'u1', role: 'basic', organizationId: 'org-platform' },
    requestedOrgSlug: 'client-a',
  });
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
  assert.equal(out.error, 'ORG_NOT_FOUND');
});

test('platform-tier (role: platform) user gets unrestricted access, same as admin', async () => {
  const resolveReportOrganizationForUser = createResolveReportOrganizationForUser({
    organizationModel: {
      async getOrganization(id) {
        if (id === 'org-platform') return { id, kind: 'platform', settings: {} };
        return null;
      },
      async getOrganizationBySlug() {
        return {
          id: 'org-client',
          kind: 'client',
          slug: 'client-a',
          settings: { services: ['pulse'] },
        };
      },
    },
    assignmentModel: {
      async userHasClientOrgAssignment() {
        return false;
      },
    },
    userModel: {
      async getBusinessUnitsForUser() {
        throw new Error('should not be called for platform tier');
      },
    },
  });

  const out = await resolveReportOrganizationForUser({
    user: { id: 'u1', role: 'platform', organizationId: 'org-platform' },
    requestedOrgSlug: 'client-a',
  });
  assert.equal(out.ok, true);
  assert.equal(out.organization.id, 'org-client');
});

test('report auth blocks generation when pulse service is disabled', async (t) => {
  const resolveReportOrganizationForUser = createResolveReportOrganizationForUser({
    organizationModel: {
      async getOrganization() {
        return {
          id: 'org-client',
          kind: 'client',
          slug: 'client-a',
          settings: { services: [] },
        };
      },
    },
    assignmentModel: {},
  });

  const out = await resolveReportOrganizationForUser({
    user: { id: 'u1', role: 'admin', organizationId: 'org-client' },
  });

  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
  assert.equal(out.error, 'GENERATION_FAILED');
});
