import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPulseLinkRoutes } from './pulseLink.js';

// Event guests share one venue Wi-Fi address. 60 people x 9 requests each
// must not trip the limiter, while one link hammering the API still does.
function buildApp() {
  const router = createPulseLinkRoutes({
    pulseLinkInviteModel: { findByTokenHash: async () => null },
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
  await withServer(buildApp(), async (base) => {
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
  await withServer(buildApp(), async (base) => {
    let last = 0;
    for (let i = 0; i < 205; i += 1) {
      last = (await fetch(`${base}/api/pulse-link/themes?token=same-guest`)).status;
    }
    assert.equal(last, 429);
  });
});
