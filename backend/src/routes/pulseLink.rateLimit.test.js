import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPulseLinkRoutes } from './pulseLink.js';
import { hashInviteToken } from '../security/inviteToken.js';

const validHashes = new Set([hashInviteToken('good-1')]);

// Event guests share one venue Wi-Fi address. 60 people x 9 requests each
// must not trip the limiter, while one link hammering the API still does.
function buildApp({ validLinks = false } = {}) {
  // Valid links resolve to an invite (the request then stops at the
  // service check with 403); invalid links get 401.
  const router = createPulseLinkRoutes({
    pulseLinkInviteModel: {
      findByTokenHash: async () => (validLinks ? { id: 'i', organization_id: 'o', token_hash: 'h' } : null),
    },
    organizationModel: { getOrganization: async () => ({ id: 'o', kind: 'client', settings: {} }) },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/pulse-link', router);
  return app;
}

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('many respondents on one address are not rate limited', async () => {
  await withServer(buildApp({ validLinks: true }), async (base) => {
    let limited = 0;
    for (let person = 0; person < 60; person += 1) {
      for (let i = 0; i < 9; i += 1) {
        const res = await fetch(`${base}/api/pulse-link/themes?token=guest-${person}`);
        if (res.status === 429) limited += 1;
      }
    }
    assert.equal(limited, 0);
  });
});

test('a single link is still limited', async () => {
  await withServer(buildApp({ validLinks: true }), async (base) => {
    let last = 0;
    for (let i = 0; i < 205; i += 1) {
      last = (await fetch(`${base}/api/pulse-link/themes?token=same-guest`)).status;
    }
    assert.equal(last, 429);
  });
});

test('repeated bad links are slowed down, but valid links from the same address still work', async () => {
  // One app instance; the invite model accepts only "good-*" links.
  const router = createPulseLinkRoutes({
    pulseLinkInviteModel: {
      findByTokenHash: async (hash) => (validHashes.has(hash) ? { id: 'i', organization_id: 'o', token_hash: hash } : null),
    },
    organizationModel: { getOrganization: async () => ({ id: 'o', kind: 'client', settings: {} }) },
  });
  const app = express();
  app.use('/api/pulse-link', router);
  await withServer(app, async (base) => {
    const bad = [];
    for (let i = 0; i < 40; i += 1) {
      bad.push((await fetch(`${base}/api/pulse-link/themes?token=wrong-${i}`)).status);
    }
    assert.equal(bad[0], 401);
    assert.equal(bad[29], 401);
    assert.equal(bad[39], 429, 'brake engaged for bad links');
    // Valid link from the same address is not refused (403 here = past the
    // link check, stopped later by the test org having no service).
    const good = await fetch(`${base}/api/pulse-link/themes?token=good-1`);
    assert.notEqual(good.status, 429);
    assert.equal(good.status, 403);
  });
});
