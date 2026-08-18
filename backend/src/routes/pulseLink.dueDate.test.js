import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPulseLinkRoutes } from './pulseLink.js';
import { hashInviteToken } from '../security/inviteToken.js';

/**
 * POV-09 regression cover: pulseInviteDueDateScopeKey used to compare
 * invite.timepoint_phase (stored internally as 'pre' | 'during' |
 * 'completed', per the pulse_link_invites_timepoint_phase_check
 * constraint) against the external stage names 'post'/'mid', which never
 * matched — so a due date configured for a During or Post wave was never
 * enforced and the survey stayed completable indefinitely. Only 'pre'
 * happened to work, because that one string is spelled the same both ways.
 * These pin all three phases.
 */

const RAW_TOKEN = 'test-link-token';

function buildRouter({ timepointPhase, timepointInstanceKey, dueDates }) {
  const invite = {
    id: 'invite-1',
    organization_id: 'org-1',
    token_hash: hashInviteToken(RAW_TOKEN),
    survey_role: 'staff',
    timepoint_phase: timepointPhase,
    timepoint_instance_key: timepointInstanceKey,
  };
  return createPulseLinkRoutes({
    organizationModel: {
      getOrganization: async () => ({
        id: 'org-1',
        kind: 'client',
        settings: { services: ['pulse'], pulseInviteDueDates: dueDates },
      }),
      getFirstOrganizationByKind: async () => null,
    },
    pulseLinkInviteModel: {
      findByTokenHash: async () => invite,
    },
    pulseSessionModel: {
      resolveSessionForPulseLink: async () => ({ id: 's1', status: 'active', audience: 'staff', deleted_at: null }),
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
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

const PAST_DATE = '2020-01-01';
const FUTURE_DATE = '2099-01-01';

const PHASES = [
  { label: 'pre', timepointPhase: 'pre', timepointInstanceKey: 'pre', scopeKey: 'pre' },
  { label: 'during', timepointPhase: 'during', timepointInstanceKey: 'session:wave-1', scopeKey: 'session:wave-1' },
  { label: 'completed (post)', timepointPhase: 'completed', timepointInstanceKey: 'post', scopeKey: 'post' },
];

for (const { label, timepointPhase, timepointInstanceKey, scopeKey } of PHASES) {
  test(`POV-09: a ${label} invite past its configured due date is refused`, async () => {
    const router = buildRouter({
      timepointPhase,
      timepointInstanceKey,
      dueDates: { [scopeKey]: PAST_DATE },
    });
    const res = await request(router, `/api/pulse-link/themes?token=${RAW_TOKEN}`);
    assert.equal(res.status, 401, `expected 401 for a ${label} invite past its due date`);
    assert.equal(res.body.error, 'Invalid or expired link');
  });

  test(`POV-09: a ${label} invite before its configured due date still works`, async () => {
    const router = buildRouter({
      timepointPhase,
      timepointInstanceKey,
      dueDates: { [scopeKey]: FUTURE_DATE },
    });
    const res = await request(router, `/api/pulse-link/themes?token=${RAW_TOKEN}`);
    assert.equal(res.status, 200, `expected 200 for a ${label} invite before its due date`);
  });

  test(`POV-09: a ${label} invite with no configured due date is unaffected`, async () => {
    const router = buildRouter({ timepointPhase, timepointInstanceKey, dueDates: {} });
    const res = await request(router, `/api/pulse-link/themes?token=${RAW_TOKEN}`);
    assert.equal(res.status, 200);
  });
}
