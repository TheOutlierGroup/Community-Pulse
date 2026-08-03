import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {
  buildRequireClientPulseService,
  requireAdmin,
  requireAuth,
  isImpersonationBlockedWrite,
  mfaVerificationState,
  mfaReverifyWindowMs,
} from './auth.js';
import { authLimiter } from '../routes/auth.js';

async function runRequest(app, { path = '/probe', method = 'GET', headers = {}, body } = {}) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const addr = server.address();
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const rawBody = await res.text();
    let responseBody;
    try {
      responseBody = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      responseBody = { raw: rawBody };
    }
    return { status: res.status, body: responseBody };
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

test('requireAuth rejects missing, malformed, tampered, and expired tokens', async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'auth-test-secret';
  const app = express();
  app.use(express.json());
  app.get('/secure', requireAuth, (_req, res) => res.json({ ok: true }));
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

  const missing = await runRequest(app, { path: '/secure' });
  assert.equal(missing.status, 401);

  const malformed = await runRequest(app, {
    path: '/secure',
    headers: { Authorization: 'Bearer not-a-jwt' },
  });
  assert.equal(malformed.status, 401);

  const valid = jwt.sign({ sub: 'user-1', role: 'employee' }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '10m',
  });
  const tampered = `${valid.slice(0, -1)}${valid.slice(-1) === 'a' ? 'b' : 'a'}`;
  const tamperedRes = await runRequest(app, {
    path: '/secure',
    headers: { Authorization: `Bearer ${tampered}` },
  });
  assert.equal(tamperedRes.status, 401);

  const expired = jwt.sign({ sub: 'user-1', role: 'employee' }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: -1,
  });
  const expiredRes = await runRequest(app, {
    path: '/secure',
    headers: { Authorization: `Bearer ${expired}` },
  });
  assert.equal(expiredRes.status, 401);
});

test('auth limiter throttles requests after threshold', async () => {
  const app = express();
  app.use(express.json());
  app.set('trust proxy', 1);
  app.post('/login-probe', authLimiter, (_req, res) => res.json({ ok: true }));
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

  let last = null;
  for (let i = 0; i < 51; i += 1) {
    last = await runRequest(app, {
      method: 'POST',
      path: '/login-probe',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
      body: { attempt: i + 1 },
    });
  }

  assert.ok(last);
  assert.equal(last.status, 429);
});

test('isImpersonationBlockedWrite blocks non-safe methods only for impersonation tokens', () => {
  assert.equal(isImpersonationBlockedWrite({ supportImpersonation: true }, 'POST'), true);
  assert.equal(isImpersonationBlockedWrite({ supportImpersonation: true }, 'PATCH'), true);
  assert.equal(isImpersonationBlockedWrite({ supportImpersonation: true }, 'DELETE'), true);
  assert.equal(isImpersonationBlockedWrite({ supportImpersonation: true }, 'GET'), false);
  assert.equal(isImpersonationBlockedWrite({ supportImpersonation: true }, 'HEAD'), false);
  assert.equal(isImpersonationBlockedWrite({ supportImpersonation: true }, 'OPTIONS'), false);
  assert.equal(isImpersonationBlockedWrite({ supportImpersonation: false }, 'POST'), false);
  assert.equal(isImpersonationBlockedWrite(null, 'POST'), false);
});

test('requireAdmin enforces MFA claim by default', async () => {
  const app = express();
  app.use(express.json());
  app.get('/admin', (req, _res, next) => {
    req.user = { role: 'admin', mfaVerifiedAt: null };
    next();
  }, requireAdmin, (_req, res) => res.json({ ok: true }));

  const blocked = await runRequest(app, { path: '/admin' });
  assert.equal(blocked.status, 403);

  const appAllowed = express();
  appAllowed.use(express.json());
  appAllowed.get('/admin', (req, _res, next) => {
    req.user = { role: 'admin', mfaVerifiedAt: new Date().toISOString() };
    next();
  }, requireAdmin, (_req, res) => res.json({ ok: true }));
  const allowed = await runRequest(appAllowed, { path: '/admin' });
  assert.equal(allowed.status, 200);
});


test('mfaVerificationState expires a verification once the window lapses', () => {
  const previous = process.env.MFA_REVERIFY_MINUTES;
  process.env.MFA_REVERIFY_MINUTES = '30';
  try {
    assert.equal(mfaVerificationState(null), 'absent');
    assert.equal(mfaVerificationState('not-a-date'), 'absent');
    assert.equal(mfaVerificationState(new Date().toISOString()), 'fresh');
    assert.equal(
      mfaVerificationState(new Date(Date.now() - 29 * 60 * 1000).toISOString()),
      'fresh'
    );
    assert.equal(
      mfaVerificationState(new Date(Date.now() - 31 * 60 * 1000).toISOString()),
      'stale'
    );
  } finally {
    if (previous === undefined) delete process.env.MFA_REVERIFY_MINUTES;
    else process.env.MFA_REVERIFY_MINUTES = previous;
  }
});

test('MFA_REVERIFY_MINUTES=0 keeps a verification valid for the token lifetime', () => {
  const previous = process.env.MFA_REVERIFY_MINUTES;
  process.env.MFA_REVERIFY_MINUTES = '0';
  try {
    assert.equal(mfaReverifyWindowMs(), 0);
    const longAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(mfaVerificationState(longAgo), 'fresh');
  } finally {
    if (previous === undefined) delete process.env.MFA_REVERIFY_MINUTES;
    else process.env.MFA_REVERIFY_MINUTES = previous;
  }
});

test('a blank or invalid MFA_REVERIFY_MINUTES falls back to the 30 minute default', () => {
  const previous = process.env.MFA_REVERIFY_MINUTES;
  try {
    delete process.env.MFA_REVERIFY_MINUTES;
    assert.equal(mfaReverifyWindowMs(), 30 * 60 * 1000);
    process.env.MFA_REVERIFY_MINUTES = 'soon';
    assert.equal(mfaReverifyWindowMs(), 30 * 60 * 1000);
    process.env.MFA_REVERIFY_MINUTES = '-5';
    assert.equal(mfaReverifyWindowMs(), 30 * 60 * 1000);
  } finally {
    if (previous === undefined) delete process.env.MFA_REVERIFY_MINUTES;
    else process.env.MFA_REVERIFY_MINUTES = previous;
  }
});

test('requireAdmin rejects a verification that has aged out, and says it is re-verifiable', async () => {
  const previous = process.env.MFA_REVERIFY_MINUTES;
  process.env.MFA_REVERIFY_MINUTES = '30';
  try {
    const app = express();
    app.use(express.json());
    app.get('/admin', (req, _res, next) => {
      req.user = { role: 'admin', mfaVerifiedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() };
      next();
    }, requireAdmin, (_req, res) => res.json({ ok: true }));

    const res = await runRequest(app, { path: '/admin' });
    assert.equal(res.status, 403);
    assert.equal(res.body.mfaRequired, true);
    assert.equal(res.body.mfaReverifyRequired, true);
  } finally {
    if (previous === undefined) delete process.env.MFA_REVERIFY_MINUTES;
    else process.env.MFA_REVERIFY_MINUTES = previous;
  }
});

test('a never-verified admin is told to enrol, not to re-verify', async () => {
  const app = express();
  app.use(express.json());
  app.get('/admin', (req, _res, next) => {
    req.user = { role: 'admin', mfaVerifiedAt: null };
    next();
  }, requireAdmin, (_req, res) => res.json({ ok: true }));

  const res = await runRequest(app, { path: '/admin' });
  assert.equal(res.status, 403);
  assert.equal(res.body.mfaRequired, true);
  assert.equal(res.body.mfaReverifyRequired, undefined);
});
