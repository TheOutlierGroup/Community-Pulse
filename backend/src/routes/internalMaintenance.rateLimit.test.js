import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { internalMaintenanceLimiter } from '../middleware/sensitiveRateLimit.js';

/**
 * PT-08: the /api/internal cron endpoints are publicly routable — Render
 * Cron cannot mount the persistent disk, so privacy maintenance is
 * invoked over HTTPS — and were protected only by a bearer secret with
 * nothing throttling attempts.
 *
 * Exercises the limiter itself rather than the real router, which would
 * need a database and the maintenance secret. What matters here is that
 * the limiter is keyed per-IP (these callers are schedulers, never
 * logged-in users, so the user-id branch never applies) and that it
 * actually stops traffic at the ceiling.
 */

async function request(app, path = '/privacy-maintenance', headers = {}) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers });
    return { status: res.status };
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

function appWithLimiter() {
  const app = express();
  app.set('trust proxy', true);
  app.use(internalMaintenanceLimiter);
  app.post('*', (_req, res) => res.json({ ok: true }));
  return app;
}

test('PT-08: unauthenticated maintenance calls are throttled at the ceiling', async () => {
  const app = appWithLimiter();
  const ip = '203.0.113.10';
  const statuses = [];
  // The limiter allows 20/hour per key; 25 attempts must not all pass.
  for (let i = 0; i < 25; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app, '/privacy-maintenance', { 'X-Forwarded-For': ip });
    statuses.push(res.status);
  }
  assert.equal(statuses[0], 200, 'the scheduler must get through normally');
  assert.ok(
    statuses.includes(429),
    'sustained attempts against the bearer secret must eventually be refused'
  );
  const allowed = statuses.filter((s) => s === 200).length;
  assert.ok(allowed <= 20, `expected at most 20 to pass, got ${allowed}`);
});

test('PT-08: the limit is per caller, not global', async () => {
  // A scheduler must not be locked out because someone else probed the
  // endpoint from a different address.
  const app = appWithLimiter();
  for (let i = 0; i < 22; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await request(app, '/privacy-maintenance', { 'X-Forwarded-For': '203.0.113.20' });
  }
  const other = await request(app, '/privacy-maintenance', { 'X-Forwarded-For': '203.0.113.21' });
  assert.equal(other.status, 200, 'a different caller keeps its own budget');
});

test('PT-08: the limiter covers every route on the router, not just one', async () => {
  const app = appWithLimiter();
  const ip = '203.0.113.30';
  const paths = ['/privacy-maintenance', '/reconciliation-run', '/licence-expiry-sweep'];
  const statuses = [];
  for (let i = 0; i < 24; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app, paths[i % paths.length], { 'X-Forwarded-For': ip });
    statuses.push(res.status);
  }
  assert.ok(
    statuses.includes(429),
    'rotating between maintenance endpoints must not reset the budget'
  );
});
