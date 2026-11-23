import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPulseLinkRoutes } from './pulseLink.js';
import { hashInviteToken } from '../security/inviteToken.js';

const RAW_TOKEN = 'event-mode-token';
const FULL_CONTEXT = {
  whatIsChanging: 'New rostering system.',
  whyAsking: 'To see how ready teams feel.',
  howUsed: 'Sets the rollout plan.',
  whenHearBack: 'By 15 December',
};

function buildRouter({ eventMode, env, role = 'staff', welcomeBodyHtml = null, completeSpy = null }) {
  const invite = {
    id: 'invite-1',
    organization_id: 'org-1',
    token_hash: hashInviteToken(RAW_TOKEN),
    survey_role: role,
    timepoint_phase: 'pre',
    display_name: 'Sam',
  };
  const settings = { services: ['pulse'], eventMode };
  if (welcomeBodyHtml) settings.pulseInviteSurveyStartTemplates = { [role]: { bodyHtml: welcomeBodyHtml } };
  const session = { id: 'session-1', name: 'Pre', status: 'active', audience: role, respondent_cap_override: 1000 };
  return createPulseLinkRoutes({
    env,
    organizationModel: {
      getOrganization: async () => ({
        id: 'org-1',
        kind: 'client',
        name: 'Acme',
        company_logo_filename: 'org-org-1.png',
        settings,
      }),
      getFirstOrganizationByKind: async () => null,
    },
    pulseLinkInviteModel: { findByTokenHash: async () => invite, updateInvitePrivacyMetadata: async () => {} },
    pulseSessionModel: {
      resolveSessionForPulseLink: async () => session,
      hasCompletedLinkResponseForInvite: async () => false,
      countCompletedRespondentsForSession: async () => ({ total: 0 }),
    },
    pulseLinkResponseModel: {
      getResponse: async () => null,
      ensureResponseRow: async () => {},
      completeResponse: async (args) => {
        if (completeSpy) completeSpy(args);
        return { stage: 'pre' };
      },
    },
    computeContributionStyleFn: () => ({ style: 'steady', scored: { valid: true } }),
    buildPersonalReflectionFn: () => ({ audience: role }),
  });
}

async function request(router, path, { method = 'GET', body } = {}) {
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
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

const ACTIVE = { enabled: true, changeName: 'Roster', primaryColor: '#0b3d91', changeContext: { pre: FULL_CONTEXT } };

test('off: questions, copy and session payload are unchanged', async () => {
  const router = buildRouter({ eventMode: ACTIVE, env: {} });
  const themes = await request(router, `/api/pulse-link/themes?token=${RAW_TOKEN}`);
  assert.equal(themes.status, 200);
  assert.doesNotMatch(themes.body.questions[0].text, /\*\*/);
  assert.equal(themes.body.copy.halfwayNote, undefined);
  const active = await request(router, `/api/pulse-link/active-session?token=${RAW_TOKEN}`);
  assert.equal(active.body.eventMode, null);
  const logo = await request(router, `/api/pulse-link/logo?token=${RAW_TOKEN}`);
  assert.equal(logo.status, 404, 'client logo is not exposed outside Event mode');
});

test('on: reworded statements, event copy and the change context for the stage', async () => {
  const router = buildRouter({ eventMode: ACTIVE, env: { EVENT_MODE_AVAILABLE: 'true' } });
  const themes = await request(router, `/api/pulse-link/themes?token=${RAW_TOKEN}`);
  assert.match(themes.body.questions[0].text, /\*\*enough support to genuinely work well\*\*/);
  assert.equal(themes.body.questions.length, 16);
  assert.match(themes.body.copy.transition, /1 \(Strongly disagree\)/);
  assert.equal(themes.body.copy.welcomeHtml, null, 'built-in fallback welcome dropped');

  const active = await request(router, `/api/pulse-link/active-session?token=${RAW_TOKEN}`);
  const em = active.body.eventMode;
  assert.equal(em.changeName, 'Roster');
  assert.deepEqual(em.changeContext, FULL_CONTEXT);
  assert.equal(em.theme.primaryColor, '#0b3d91');
  assert.equal(em.hasLogo, true);
  assert.match(em.confidentiality, /never shown to your manager/);
  assert.match(em.confidentiality, /5 or more/);
});

test('on: a client-written welcome template is still shown', async () => {
  const router = buildRouter({
    eventMode: ACTIVE,
    env: { EVENT_MODE_AVAILABLE: 'true' },
    welcomeBodyHtml: '<p>Hello from {{clientname}}</p>',
  });
  const themes = await request(router, `/api/pulse-link/themes?token=${RAW_TOKEN}`);
  assert.match(themes.body.copy.welcomeHtml, /Hello from Acme/);
});

test('on: managers get the manager confidentiality wording, not the staff promise', async () => {
  const router = buildRouter({ eventMode: ACTIVE, env: { EVENT_MODE_AVAILABLE: 'true' }, role: 'manager' });
  const active = await request(router, `/api/pulse-link/active-session?token=${RAW_TOKEN}`);
  assert.doesNotMatch(active.body.eventMode.confidentiality, /never shown to your manager/);
  assert.match(active.body.eventMode.confidentiality, /alongside your team's results/);
});

test('completion records which wording version the respondent saw', async () => {
  const seen = [];
  const on = buildRouter({ eventMode: ACTIVE, env: { EVENT_MODE_AVAILABLE: 'true' }, completeSpy: (a) => seen.push(a) });
  const off = buildRouter({ eventMode: ACTIVE, env: {}, completeSpy: (a) => seen.push(a) });
  await request(on, `/api/pulse-link/response/complete?token=${RAW_TOKEN}`, { method: 'POST', body: {} });
  await request(off, `/api/pulse-link/response/complete?token=${RAW_TOKEN}`, { method: 'POST', body: {} });
  assert.equal(seen[0].wordingVersion, 'event-v1');
  assert.equal(seen[1].wordingVersion, 'current');
});

test('logo needs a valid respondent token', async () => {
  const router = buildRouter({ eventMode: ACTIVE, env: { EVENT_MODE_AVAILABLE: 'true' } });
  const res = await request(router, '/api/pulse-link/logo');
  assert.equal(res.status, 401);
});
