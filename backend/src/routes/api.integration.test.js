import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createEmployeeRoutes } from './employees.js';
import { createPulseLinkRoutes } from './pulseLink.js';
import { createAdminRoutes } from './admin.js';
import { createAnalyticsRoutes } from './analytics.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  return app;
}

function buildPulseLinkApp({
  invite = null,
  clientOrgSettings = { services: ['pulse'] },
  platformOrgSettings = null,
} = {}) {
  const organizationModel = {
    async getOrganization() {
      return { kind: 'client', settings: clientOrgSettings };
    },
    async getFirstOrganizationByKind(kind) {
      if (kind !== 'platform' || !platformOrgSettings) return null;
      return { kind: 'platform', settings: platformOrgSettings };
    },
  };
  const pulseLinkInviteModel = {
    async findByTokenHash() {
      return invite || {
        id: 'invite-1',
        token_hash: 'stub-hash',
        organization_id: 'org-a',
        survey_role: 'staff',
        timepoint_phase: 'pre',
      };
    },
  };
  const pulseSessionModel = {
    async resolveSessionForPulseLink() {
      return { id: 'session-staff-1', name: 'Staff Wave', status: 'active', audience: 'staff' };
    },
  };
  const pulseLinkResponseModel = {
    async getResponse() {
      return null;
    },
    async ensureResponseRow() {},
    async markSurveyStarted() {
      return { id: 'link-resp-1' };
    },
  };
  const app = buildApp();
  app.use(
    '/api/pulse-link',
    createPulseLinkRoutes({
      organizationModel,
      pulseSessionModel,
      pulseLinkInviteModel,
      pulseLinkResponseModel,
    })
  );
  return app;
}

async function requestJson(app, { method = 'GET', path, headers = {}, body }) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const addr = server.address();
    const requestHeaders = { 'Content-Type': 'application/json', ...headers };
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method,
      headers: requestHeaders,
      body: body == null ? undefined : JSON.stringify(body),
    });
    const payload = await res.json();
    return { status: res.status, body: payload };
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

function fullEmployeeAnswers(value = 3) {
  const answers = {};
  for (let i = 1; i <= 16; i += 1) answers[`Q${i}`] = value;
  return answers;
}

function fullManagerAnswers(value = 3) {
  const answers = {};
  for (let i = 1; i <= 16; i += 1) answers[`MQ${i}`] = value;
  return answers;
}

function employeeAuth(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: 'Unauthorized' });
  req.user = { id: 'employee-1', role: 'employee', organizationId: 'org-a' };
  req.clientOrganization = { kind: 'client', settings: { services: ['pulse'] } };
  next();
}

function adminAuth(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: 'Unauthorized' });
  req.user = { id: 'admin-1', role: 'admin', organizationId: 'org-a' };
  req.clientOrganization = { kind: 'client', settings: { services: ['pulse'] } };
  next();
}

test('pulse complete integration: validation blocks write, complete writes once', async () => {
  let completeCalls = 0;
  const pulseSessionModel = {
    async getActiveSessionForOrg() {
      return { id: 'session-staff-1', name: 'Staff Wave', status: 'active', audience: 'staff' };
    },
  };
  const employeeResponseModel = {
    async getResponse() {
      return null;
    },
    async ensureResponseRow() {},
    async completeResponse() {
      completeCalls += 1;
      return { id: 'resp-1', current_step: 5, completed_at: new Date().toISOString() };
    },
    async upsertResponseDraft() {
      return { current_step: 1, step1_data: {}, step2_data: {}, step3_data: {}, step4_data: {} };
    },
  };
  const app = buildApp();
  app.use(
    '/api/pulse',
    createEmployeeRoutes({
      authMiddleware: employeeAuth,
      pulseServiceMiddleware: (_req, _res, next) => next(),
      pulseSessionModel,
      employeeResponseModel,
    })
  );

  const invalid = await requestJson(app, {
    method: 'POST',
    path: '/api/pulse/response/complete',
    headers: { Authorization: 'Bearer test' },
    body: { step1: { answers: { Q1: 5 } } },
  });
  assert.equal(invalid.status, 400);
  assert.equal(completeCalls, 0);

  const valid = await requestJson(app, {
    method: 'POST',
    path: '/api/pulse/response/complete',
    headers: { Authorization: 'Bearer test' },
    body: { step1: { answers: fullEmployeeAnswers(4) } },
  });
  assert.equal(valid.status, 200);
  assert.equal(completeCalls, 1);
  assert.equal(valid.body.reflection.incomplete, false);
  assert.equal(valid.body.reflection.adoptionScore, 32);
});

test('pulse-link complete integration: token flow and write guard', async () => {
  let completeCalls = 0;
  const organizationModel = {
    async getOrganization() {
      return { kind: 'client', settings: { services: ['pulse'] } };
    },
  };
  const pulseLinkInviteModel = {
    async findByTokenHash() {
      return {
        id: 'invite-1',
        token_hash: 'stub-hash',
        organization_id: 'org-a',
        survey_role: 'manager',
        timepoint_phase: 'completed',
      };
    },
  };
  const pulseSessionModel = {
    async resolveSessionForPulseLink() {
      return { id: 'session-mgr-1', name: 'Manager Wave', status: 'active', audience: 'manager' };
    },
  };
  const pulseLinkResponseModel = {
    async getResponse() {
      return null;
    },
    async ensureResponseRow() {},
    async completeResponse() {
      completeCalls += 1;
      return { id: 'link-resp-1', current_step: 5, completed_at: new Date().toISOString() };
    },
    async upsertResponseDraft() {
      return { current_step: 1, step1_data: {}, step2_data: {}, step3_data: {}, step4_data: {} };
    },
    async markSurveyStarted() {
      return { id: 'link-resp-1' };
    },
  };

  const app = buildApp();
  app.use(
    '/api/pulse-link',
    createPulseLinkRoutes({
      organizationModel,
      pulseSessionModel,
      pulseLinkInviteModel,
      pulseLinkResponseModel,
    })
  );

  const invalid = await requestJson(app, {
    method: 'POST',
    path: '/api/pulse-link/response/complete?token=demo-token',
    body: { step1: { answers: { MQ1: 5 } } },
  });
  assert.equal(invalid.status, 400);
  assert.equal(completeCalls, 0);

  const valid = await requestJson(app, {
    method: 'POST',
    path: '/api/pulse-link/response/complete?token=demo-token&stage=post',
    body: { step1: { answers: fullManagerAnswers(4) } },
  });
  assert.equal(valid.status, 200);
  assert.equal(completeCalls, 1);
  assert.equal(valid.body.reflection.incomplete, false);
  assert.equal(valid.body.reflection.managerLoadScore, 16);

  const mismatchedStage = await requestJson(app, {
    method: 'GET',
    path: '/api/pulse-link/themes?token=demo-token&stage=pre',
  });
  assert.equal(mismatchedStage.status, 400);
});

test('pulse-link themes uses client survey start template over platform default', async () => {
  const app = buildPulseLinkApp({
    clientOrgSettings: {
      services: ['pulse'],
      pulseInviteSurveyStartTemplates: {
        pre: {
          staff: {
            bodyHtml: '<p>Client override intro</p><p>Client override context</p>',
          },
        },
      },
    },
    platformOrgSettings: {
      pulseInviteDefaultSurveyStartTemplates: {
        pre: {
          staff: {
            bodyHtml: '<p>Platform default intro</p><p>Platform default context</p>',
          },
        },
      },
    },
  });

  const response = await requestJson(app, {
    path: '/api/pulse-link/themes?token=demo-token&stage=pre',
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.copy?.welcomeHtml, '<p>Client override intro</p><p>Client override context</p>');
});

test('pulse-link themes falls back to platform default survey start template', async () => {
  const app = buildPulseLinkApp({
    clientOrgSettings: {
      services: ['pulse'],
    },
    platformOrgSettings: {
      pulseInviteDefaultSurveyStartTemplates: {
        pre: {
          staff: {
            bodyHtml: '<p>Platform default intro</p><p>Platform default context</p>',
          },
        },
      },
    },
  });

  const response = await requestJson(app, {
    path: '/api/pulse-link/themes?token=demo-token&stage=pre',
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.copy?.welcomeHtml, '<p>Platform default intro</p><p>Platform default context</p>');
});

test('pulse-link themes falls back to built-in survey copy when no templates exist', async () => {
  const app = buildPulseLinkApp({
    clientOrgSettings: {
      services: ['pulse'],
    },
    platformOrgSettings: null,
  });

  const response = await requestJson(app, {
    path: '/api/pulse-link/themes?token=demo-token&stage=pre',
  });
  assert.equal(response.status, 200);
  assert.equal(
    response.body.copy?.welcomeHtml,
    '<p>Before this change starts, we want to understand how ready the organisation is. Your honest responses are anonymous and help identify where support is needed.</p><p>Your answers help leaders understand what’s working and what might need attention.</p>'
  );
});

test('admin and analytics integration endpoints return scoped payloads', async () => {
  const pulseSessionModel = {
    async listSessionsForOrg() {
      return [{ id: 'session-1', name: 'Wave 1', status: 'active', audience: 'staff' }];
    },
    async getSessionById(id) {
      return { id, name: 'Wave 1', status: 'active', audience: 'staff' };
    },
  };
  const listSessionResponsesFn = async () => ({
    rows: [
      { completed_at: '2026-01-01T00:00:00.000Z', source_type: 'employee' },
      { completed_at: null, source_type: 'employee' },
    ],
    responseContract: { mode: 'all' },
  });
  const actionPlanModel = {
    async getActionPlan() {
      return null;
    },
    async upsertActionPlan() {
      return { id: 'plan-1' };
    },
  };
  const app = buildApp();
  app.use(
    '/api/admin',
    createAdminRoutes({
      authMiddleware: adminAuth,
      adminMiddleware: (_req, _res, next) => next(),
      clientOrgMiddleware: (_req, _res, next) => next(),
      pulseServiceMiddleware: (_req, _res, next) => next(),
      pulseSessionModel,
      listSessionResponsesFn,
    })
  );
  app.use(
    '/api/analytics',
    createAnalyticsRoutes({
      authMiddleware: adminAuth,
      adminMiddleware: (_req, _res, next) => next(),
      clientOrgMiddleware: (_req, _res, next) => next(),
      pulseServiceMiddleware: (_req, _res, next) => next(),
      pulseSessionModel,
      actionPlanModel,
      listSessionResponsesFn,
      aggregateSessionResponsesFn: () => ({
        averages: { readiness: 31.2 },
        hotspots: ['1C'],
        strengths: ['2A'],
        tensionPairs: [],
        participationRate: 1,
        avgNps: 8.1,
      }),
      writeSessionExportFn: async () => ({ filename: 'session-1-export.json' }),
    })
  );

  const overview = await requestJson(app, {
    path: '/api/admin/overview',
    headers: { Authorization: 'Bearer admin' },
  });
  assert.equal(overview.status, 200);
  assert.equal(overview.body.participation.total, 2);
  assert.equal(overview.body.participation.completed, 1);

  const responses = await requestJson(app, {
    path: '/api/admin/sessions/session-1/responses',
    headers: { Authorization: 'Bearer admin' },
  });
  assert.equal(responses.status, 200);
  assert.equal(responses.body.responses.length, 2);

  const analytics = await requestJson(app, {
    path: '/api/analytics/sessions/session-1',
    headers: { Authorization: 'Bearer admin' },
  });
  assert.equal(analytics.status, 200);
  assert.equal(analytics.body.analytics.averages.readiness, 31.2);

  const exported = await requestJson(app, {
    method: 'POST',
    path: '/api/analytics/sessions/session-1/export',
    headers: { Authorization: 'Bearer admin' },
  });
  assert.equal(exported.status, 200);
  assert.equal(exported.body.filename, 'session-1-export.json');
});

test('admin route enforces tenant-aware session scope and unauthorized requests', async () => {
  let seenOrgId = null;
  const pulseSessionModel = {
    async listSessionsForOrg() {
      return [{ id: 'session-1', name: 'Wave 1', status: 'active', audience: 'staff' }];
    },
    async getSessionById(id, orgId) {
      seenOrgId = orgId;
      if (orgId !== 'org-a') return null;
      return { id, name: 'Wave 1', status: 'active', audience: 'staff' };
    },
  };
  const listSessionResponsesFn = async () => ({ rows: [], responseContract: {} });
  const app = buildApp();
  app.use(
    '/api/admin',
    createAdminRoutes({
      authMiddleware: adminAuth,
      adminMiddleware: (_req, _res, next) => next(),
      clientOrgMiddleware: (_req, _res, next) => next(),
      pulseServiceMiddleware: (_req, _res, next) => next(),
      pulseSessionModel,
      listSessionResponsesFn,
    })
  );

  const unauthorized = await requestJson(app, {
    path: '/api/admin/sessions/session-1/responses',
  });
  assert.equal(unauthorized.status, 401);

  const scoped = await requestJson(app, {
    path: '/api/admin/sessions/session-1/responses',
    headers: { Authorization: 'Bearer admin' },
  });
  assert.equal(scoped.status, 200);
  assert.equal(seenOrgId, 'org-a');
});

test('analytics export strips raw answer payloads (privacy guard)', async () => {
  let exportedPayload = null;
  const pulseSessionModel = {
    async getSessionById(id) {
      return { id, name: 'Wave 1', status: 'active', audience: 'staff' };
    },
  };
  const rows = [
    {
      source_type: 'employee',
      completed_at: '2026-01-01T00:00:00.000Z',
      contribution_style: 'Optimal',
      step1_data: { answers: { Q1: 5 } },
      step2_data: { answers: { Q2: 5 } },
      step3_data: { answers: { Q3: 5 } },
      step4_data: { answers: { Q4: 5 } },
      email: 'sensitive@example.com',
    },
  ];
  const app = buildApp();
  app.use(
    '/api/analytics',
    createAnalyticsRoutes({
      authMiddleware: adminAuth,
      adminMiddleware: (_req, _res, next) => next(),
      clientOrgMiddleware: (_req, _res, next) => next(),
      pulseServiceMiddleware: (_req, _res, next) => next(),
      pulseSessionModel,
      actionPlanModel: { async getActionPlan() { return null; } },
      listSessionResponsesFn: async () => ({ rows, responseContract: {} }),
      aggregateSessionResponsesFn: () => ({ participationRate: 1, hotspots: [], strengths: [], tensionPairs: [] }),
      writeSessionExportFn: async (_sessionId, payload) => {
        exportedPayload = payload;
        return { filename: 'privacy-export.json' };
      },
    })
  );

  const res = await requestJson(app, {
    method: 'POST',
    path: '/api/analytics/sessions/session-1/export',
    headers: { Authorization: 'Bearer admin' },
  });
  assert.equal(res.status, 200);
  assert.ok(exportedPayload);
  assert.equal(exportedPayload.responses.length, 1);
  assert.deepEqual(Object.keys(exportedPayload.responses[0]).sort(), [
    'completedAt',
    'contributionStyle',
    'sourceType',
    'stage',
  ]);
});

test('admin session routes accept paused status lifecycle', async () => {
  const captured = { createdStatus: null, patchedStatus: null };
  const pulseSessionModel = {
    async createSession(_orgId, _name, status) {
      captured.createdStatus = status;
      return { id: 'session-1', status };
    },
    async updateSessionStatus(_id, _orgId, status) {
      captured.patchedStatus = status;
      return { id: 'session-1', status };
    },
    async listSessionsForOrg() {
      return [];
    },
  };
  const app = buildApp();
  app.use(
    '/api/admin',
    createAdminRoutes({
      authMiddleware: adminAuth,
      adminMiddleware: (_req, _res, next) => next(),
      clientOrgMiddleware: (_req, _res, next) => next(),
      pulseServiceMiddleware: (_req, _res, next) => next(),
      pulseSessionModel,
      listSessionResponsesFn: async () => ({ rows: [], responseContract: {} }),
    })
  );

  const created = await requestJson(app, {
    method: 'POST',
    path: '/api/admin/sessions',
    headers: { Authorization: 'Bearer admin' },
    body: { name: 'Paused test', status: 'paused' },
  });
  assert.equal(created.status, 201);
  assert.equal(captured.createdStatus, 'paused');

  const patched = await requestJson(app, {
    method: 'PATCH',
    path: '/api/admin/sessions/session-1',
    headers: { Authorization: 'Bearer admin' },
    body: { status: 'paused' },
  });
  assert.equal(patched.status, 200);
  assert.equal(captured.patchedStatus, 'paused');
});

