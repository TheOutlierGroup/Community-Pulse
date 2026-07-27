import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPulseLinkRoutes } from './pulseLink.js';
import { hashInviteToken } from '../security/inviteToken.js';

/**
 * PT-03 regression cover: a public survey link must not write into a
 * session an admin has closed, paused or soft-deleted.
 *
 * The signed-in employee path resolves via getActiveSessionForOrg, which
 * filters `status = 'active' AND deleted_at IS NULL`. The public link path
 * resolves via resolveSessionForPulseLink, whose first lookup filters on
 * neither — so closing a wave locked the signed-in flow while leaving the
 * link flow wide open. These tests pin both halves: closed/paused/deleted
 * are refused, draft/active still work (lazy-init provisions During and
 * Post as draft, so requiring 'active' would break those stages).
 */

const RAW_TOKEN = 'test-link-token';

function buildRouter(session, overrides = {}) {
  const invite = {
    id: 'invite-1',
    organization_id: 'org-1',
    token_hash: hashInviteToken(RAW_TOKEN),
    survey_role: 'staff',
    timepoint_phase: 'pre',
    settings: {},
  };
  return createPulseLinkRoutes({
    organizationModel: {
      getOrganization: async () => ({
        id: 'org-1',
        kind: 'client',
        settings: { services: ['pulse'] },
      }),
      getFirstOrganizationByKind: async () => null,
    },
    pulseLinkInviteModel: {
      findByTokenHash: async () => invite,
      updateInvitePrivacyMetadata: async () => null,
    },
    pulseSessionModel: {
      resolveSessionForPulseLink: async () => session,
      hasCompletedLinkResponseForInvite: async () => false,
      countCompletedRespondentsForSession: async () => ({ total: 0 }),
    },
    pulseLinkResponseModel: {
      ensureResponseRow: async () => ({}),
      getResponse: async () => null,
      markSurveyStarted: async () => ({ ok: true }),
      upsertResponseDraft: async () => ({
        stage: 'pre',
        current_step: 1,
        step1_data: {},
        step2_data: {},
        step3_data: {},
        step4_data: {},
      }),
      ...overrides.pulseLinkResponseModel,
    },
  });
}

async function request(router, { path, method = 'GET', body } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/pulse-link', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    return { status: res.status, body: payload };
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

const WRITE_ROUTES = [
  { name: 'survey-started', path: `/api/pulse-link/survey-started?token=${RAW_TOKEN}`, method: 'POST', body: {} },
  { name: 'response step', path: `/api/pulse-link/response/step/1?token=${RAW_TOKEN}`, method: 'PUT', body: { step1: {} } },
  { name: 'response complete', path: `/api/pulse-link/response/complete?token=${RAW_TOKEN}`, method: 'POST', body: {} },
];

const REFUSED_SESSIONS = [
  { label: 'closed', session: { id: 's1', status: 'closed', audience: 'staff', deleted_at: null } },
  { label: 'paused', session: { id: 's1', status: 'paused', audience: 'staff', deleted_at: null } },
  {
    label: 'soft-deleted',
    session: { id: 's1', status: 'active', audience: 'staff', deleted_at: new Date().toISOString() },
  },
];

for (const { label, session } of REFUSED_SESSIONS) {
  for (const route of WRITE_ROUTES) {
    test(`PT-03: ${route.name} refuses a ${label} session`, async () => {
      const router = buildRouter(session);
      const res = await request(router, route);
      assert.equal(res.status, 403, `expected 403 for ${label} session on ${route.name}`);
      assert.equal(res.body.sessionClosed, true);
    });
  }
}

for (const status of ['active', 'draft']) {
  test(`PT-03: survey-started still accepted for a ${status} session`, async () => {
    const router = buildRouter({ id: 's1', status, audience: 'staff', deleted_at: null });
    const res = await request(router, WRITE_ROUTES[0]);
    assert.equal(res.status, 200, `expected ${status} session to accept writes`);
    assert.equal(res.body.ok, true);
  });
}

test('PT-03: a closed session does not reach the response writer at all', async () => {
  let wrote = false;
  const router = buildRouter(
    { id: 's1', status: 'closed', audience: 'staff', deleted_at: null },
    {
      pulseLinkResponseModel: {
        upsertResponseDraft: async () => {
          wrote = true;
          return {};
        },
      },
    }
  );
  const res = await request(router, WRITE_ROUTES[1]);
  assert.equal(res.status, 403);
  assert.equal(wrote, false, 'closed session must short-circuit before any write');
});
