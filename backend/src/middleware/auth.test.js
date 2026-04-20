import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildRequireClientPulseService } from './auth.js';

async function runRequest(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const addr = server.address();
    const res = await fetch(`http://127.0.0.1:${addr.port}/probe`);
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

function testAppForOrganization(org) {
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader('Content-Type', 'application/json');
    next();
  });
  app.use((req, _res, next) => {
    req.user = { organizationId: 'org-1' };
    next();
  });
  const middleware = buildRequireClientPulseService({
    getOrganization: async () => org,
  });
  app.get('/probe', middleware, (_req, res) => res.json({ ok: true }));
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));
  return app;
}

test('requireClientPulseService returns 403 when pulse is disabled', async () => {
  const app = testAppForOrganization({ kind: 'client', settings: { services: [] } });
  const out = await runRequest(app);
  assert.equal(out.status, 403);
  assert.equal(out.body.error, 'Rhythm Engine is not enabled for this client');
});

test('requireClientPulseService returns 200 when pulse is enabled', async () => {
  const app = testAppForOrganization({ kind: 'client', settings: { services: ['pulse'] } });
  const out = await runRequest(app);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true });
});

test('requireClientPulseService allows legacy pulseEnabled compatibility', async () => {
  const app = testAppForOrganization({ kind: 'client', settings: { pulseEnabled: true } });
  const out = await runRequest(app);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true });
});

test('requireClientPulseService denies when explicit services omit pulse', async () => {
  const app = testAppForOrganization({
    kind: 'client',
    settings: { services: [], pulseEnabled: true },
  });
  const out = await runRequest(app);
  assert.equal(out.status, 403);
  assert.equal(out.body.error, 'Rhythm Engine is not enabled for this client');
});

