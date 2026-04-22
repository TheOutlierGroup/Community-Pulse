import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createReportsRoutes } from './reports.js';

function auth(req, _res, next) {
  req.user = { id: 'user-1', role: 'admin', organizationId: 'org-1', organizationKind: 'client' };
  next();
}

async function request(app, { path, method = 'GET', body } = {}) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    const text = await res.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    return { status: res.status, body: payload, headers: res.headers };
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

function appWithRouter(router) {
  const app = express();
  app.use(express.json());
  app.use('/api/reports', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));
  return app;
}

test('GET /api/reports requires org selector', async () => {
  const router = createReportsRoutes({
    authMiddleware: auth,
    generatedReportModel: {},
    resolveReportOrganizationForUserFn: async () => ({ ok: true, organization: { id: 'org-1' } }),
  });
  const app = appWithRouter(router);
  const res = await request(app, { path: '/api/reports' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /org_id or org_slug is required/i);
});

test('POST /api/reports/generate returns validation error', async () => {
  const router = createReportsRoutes({
    authMiddleware: auth,
    generatedReportModel: {},
    validateReportRequestFn: () => ({ ok: false, error: 'INVALID_STAGE', message: 'Invalid stage' }),
  });
  const app = appWithRouter(router);
  const res = await request(app, { path: '/api/reports/generate', method: 'POST', body: {} });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_STAGE');
});

test('GET /api/reports/:id redirects with signed download token', async () => {
  const router = createReportsRoutes({
    authMiddleware: auth,
    generatedReportModel: {
      async getGeneratedReportById() {
        return {
          id: 'report-1',
          status: 'complete',
          organization_id: 'org-1',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        };
      },
    },
    resolveReportOrganizationForUserFn: async () => ({ ok: true, organization: { id: 'org-1' } }),
    createReportDownloadTokenFn: () => 'signed-token',
  });
  const app = appWithRouter(router);
  const res = await request(app, { path: '/api/reports/report-1' });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location') || '', /download\/report-1\?token=signed-token/);
});

test('GET /api/reports/:id returns forbidden when org access fails', async () => {
  const router = createReportsRoutes({
    authMiddleware: auth,
    generatedReportModel: {
      async getGeneratedReportById() {
        return {
          id: 'report-1',
          status: 'complete',
          organization_id: 'org-2',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        };
      },
    },
    resolveReportOrganizationForUserFn: async () => ({ ok: false, status: 403, error: 'ORG_NOT_FOUND' }),
  });
  const app = appWithRouter(router);
  const res = await request(app, { path: '/api/reports/report-1' });
  assert.equal(res.status, 403);
});

test('GET /api/reports/download/:id rejects invalid token or token mismatches', async () => {
  const baseDeps = {
    authMiddleware: auth,
    generatedReportModel: {
      async getGeneratedReportById() {
        return {
          id: 'report-1',
          status: 'complete',
          organization_id: 'org-1',
          file_path: '/tmp/missing-file.docx',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        };
      },
    },
    resolveReportOrganizationForUserFn: async () => ({ ok: true, organization: { id: 'org-1' } }),
    fileExistsFn: () => false,
  };

  const invalidTokenRouter = createReportsRoutes({
    ...baseDeps,
    verifyReportDownloadTokenFn: () => null,
  });
  const app1 = appWithRouter(invalidTokenRouter);
  const invalid = await request(app1, { path: '/api/reports/download/report-1?token=bad' });
  assert.equal(invalid.status, 403);

  const mismatchRouter = createReportsRoutes({
    ...baseDeps,
    verifyReportDownloadTokenFn: () => ({
      reportId: 'other-report',
      userId: 'user-1',
      organizationId: 'org-1',
    }),
  });
  const app2 = appWithRouter(mismatchRouter);
  const mismatch = await request(app2, { path: '/api/reports/download/report-1?token=ok' });
  assert.equal(mismatch.status, 403);
});

test('GET /api/reports/download/:id enforces expiration and file presence', async () => {
  const expiredRouter = createReportsRoutes({
    authMiddleware: auth,
    verifyReportDownloadTokenFn: () => ({ reportId: 'report-1', userId: 'user-1', organizationId: 'org-1' }),
    generatedReportModel: {
      async getGeneratedReportById() {
        return {
          id: 'report-1',
          status: 'complete',
          organization_id: 'org-1',
          file_path: '/tmp/report.docx',
          expires_at: new Date(Date.now() - 1000).toISOString(),
        };
      },
    },
    resolveReportOrganizationForUserFn: async () => ({ ok: true, organization: { id: 'org-1' } }),
    fileExistsFn: () => true,
  });
  const app1 = appWithRouter(expiredRouter);
  const expired = await request(app1, { path: '/api/reports/download/report-1?token=ok' });
  assert.equal(expired.status, 404);
  assert.match(expired.body.error, /expired/i);

  const missingFileRouter = createReportsRoutes({
    authMiddleware: auth,
    verifyReportDownloadTokenFn: () => ({ reportId: 'report-1', userId: 'user-1', organizationId: 'org-1' }),
    generatedReportModel: {
      async getGeneratedReportById() {
        return {
          id: 'report-1',
          status: 'complete',
          organization_id: 'org-1',
          file_path: '/tmp/report.docx',
          expires_at: new Date(Date.now() + 1000).toISOString(),
        };
      },
    },
    resolveReportOrganizationForUserFn: async () => ({ ok: true, organization: { id: 'org-1' } }),
    fileExistsFn: () => false,
  });
  const app2 = appWithRouter(missingFileRouter);
  const missing = await request(app2, { path: '/api/reports/download/report-1?token=ok' });
  assert.equal(missing.status, 404);
  assert.match(missing.body.error, /file not found/i);
});
