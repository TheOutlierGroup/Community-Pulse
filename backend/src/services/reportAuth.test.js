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
