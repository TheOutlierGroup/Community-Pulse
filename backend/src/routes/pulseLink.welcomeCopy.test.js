import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPulseLinkRoutes } from './pulseLink.js';
import { hashInviteToken } from '../security/inviteToken.js';

// D-021: the welcome-template editor advertises {{clientname}} as a usable
// token and substitutes it in the admin's own preview, but the public
// survey link served the token back to respondents completely unresolved
// -- literally, verbatim, in the page they land on.

const RAW_TOKEN = 'welcome-copy-token';

function buildRouter({ orgName, welcomeBodyHtml }) {
  const invite = {
    id: 'invite-1',
    organization_id: 'org-1',
    token_hash: hashInviteToken(RAW_TOKEN),
    survey_role: 'staff',
    timepoint_phase: 'pre',
  };
  return createPulseLinkRoutes({
    organizationModel: {
      getOrganization: async () => ({
        id: 'org-1',
        kind: 'client',
        name: orgName,
        settings: {
          services: ['pulse'],
          pulseInviteSurveyStartTemplates: {
            staff: { bodyHtml: welcomeBodyHtml },
          },
        },
      }),
      getFirstOrganizationByKind: async () => null,
    },
    pulseLinkInviteModel: {
      findByTokenHash: async () => invite,
    },
  });
}

async function request(router, path) {
  const app = express();
  app.use(express.json());
  app.use('/api/pulse-link', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test('D-021: {{clientname}} in a welcome template resolves to the real org name for respondents', async () => {
  const router = buildRouter({
    orgName: 'Acme Co',
    welcomeBodyHtml: '<p>Thanks for helping {{clientname}} understand how things are going.</p>',
  });
  const res = await request(router, `/api/pulse-link/themes?token=${RAW_TOKEN}`);
  assert.equal(res.status, 200);
  assert.match(res.body.copy.welcomeHtml, /Thanks for helping Acme Co understand/);
  assert.doesNotMatch(res.body.copy.welcomeHtml, /\{\{\s*clientname\s*\}\}/i);
});

test('D-021: {{clientname}} substitution is case-insensitive and handles missing org name gracefully', async () => {
  const router = buildRouter({
    orgName: '',
    welcomeBodyHtml: '<p>Welcome to {{clientName}}.</p>',
  });
  const res = await request(router, `/api/pulse-link/themes?token=${RAW_TOKEN}`);
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.body.copy.welcomeHtml, /\{\{\s*clientname\s*\}\}/i);
});
