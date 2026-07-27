import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPulseLinkRoutes } from './pulseLink.js';
import { hashInviteToken } from '../security/inviteToken.js';

/**
 * PT-06 regression cover: the unauthenticated survey surface must never
 * provision a pulse_sessions row.
 *
 * resolveSessionForPulseLink ends in a createSession fallback. Because
 * the public routes call it on unauthenticated requests, a link holder
 * could cause session rows to be written as a side effect of opening a
 * survey — an unauthenticated write primitive, and the same complaint as
 * RED-017 (checkpoints appearing that nobody created) reached from
 * outside the trust boundary.
 */

const RAW_TOKEN = 'test-link-token';

function buildRouter({ session = null, onResolve = () => {} } = {}) {
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
      resolveSessionForPulseLink: async (orgId, audience, stage, options) => {
        onResolve(options);
        return session;
      },
      hasCompletedLinkResponseForInvite: async () => false,
      countCompletedRespondentsForSession: async () => ({ total: 0 }),
    },
    pulseLinkResponseModel: {
      ensureResponseRow: async () => ({}),
      // Must be a real row shape: the /response handler dereferences it
      // directly, and Express 4 does not catch a throw from an async
      // handler — the request would hang rather than fail.
      getResponse: async () => ({
        current_step: 1,
        stage: 'pre',
        step1_data: {},
        step2_data: {},
        step3_data: {},
        step4_data: {},
        contribution_style: null,
        completed_at: null,
        survey_started_at: new Date().toISOString(),
      }),
      markSurveyStarted: async () => ({ ok: true }),
      upsertResponseDraft: async () => ({
        stage: 'pre',
        current_step: 1,
        step1_data: {},
        step2_data: {},
        step3_data: {},
        step4_data: {},
      }),
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

const ROUTES = [
  { name: 'active-session', path: `/api/pulse-link/active-session?token=${RAW_TOKEN}`, method: 'GET' },
  { name: 'response', path: `/api/pulse-link/response?token=${RAW_TOKEN}`, method: 'GET' },
  { name: 'survey-started', path: `/api/pulse-link/survey-started?token=${RAW_TOKEN}`, method: 'POST', body: {} },
  { name: 'response step', path: `/api/pulse-link/response/step/1?token=${RAW_TOKEN}`, method: 'PUT', body: { step1: {} } },
  { name: 'response complete', path: `/api/pulse-link/response/complete?token=${RAW_TOKEN}`, method: 'POST', body: {} },
];

// Every route resolves the session before doing anything else, so a null
// session exercises both assertions at once and — importantly — returns
// before /active-session reaches resolveBrandForOrganization, which is
// imported directly rather than injected and would need a live database.
for (const route of ROUTES) {
  test(`PT-06: ${route.name} never provisions, and reports the empty state`, async () => {
    const seen = [];
    const router = buildRouter({
      session: null,
      onResolve: (options) => seen.push(options),
    });
    const res = await request(router, route);

    assert.ok(seen.length > 0, 'route should have resolved a session');
    for (const options of seen) {
      assert.equal(options?.allowCreate, false, `${route.name} must not provision`);
    }

    // Previously this path created a session row; now it reports the
    // state rather than writing one or crashing on a null dereference.
    assert.equal(res.status, 403, `${route.name} should refuse, not 500`);
    assert.equal(res.body.sessionClosed, true);
    assert.equal(res.body.sessionStatus, 'none', 'distinct from an admin-closed wave');
  });
}
