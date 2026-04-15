import test from 'node:test';
import assert from 'node:assert/strict';

import { listSessionResponses, RESPONSE_MODE_EMPLOYEE_ONLY } from './pulseDataContract.js';

test('listSessionResponses returns employee-only rows and contract', async () => {
  const employeeResponseModel = {
    listResponsesForSession: async () => [{ id: 'er-1', role: 'employee', step1_data: { q1: 4 } }],
  };
  const pulseLinkResponseModel = {
    listResponsesForSession: async () => [{ id: 'lr-1' }],
  };

  const out = await listSessionResponses('session-1', {
    mode: RESPONSE_MODE_EMPLOYEE_ONLY,
    employeeResponseModel,
    pulseLinkResponseModel,
  });
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].source_type, 'employee');
  assert.deepEqual(out.responseContract.cohortsIncluded, ['employee']);
  assert.equal(out.responseContract.includesLinkInviteRespondents, false);
});

test('listSessionResponses returns merged rows and normalizes link role', async () => {
  const employeeResponseModel = {
    listResponsesForSession: async () => [{ id: 'er-1', role: 'employee' }],
  };
  const pulseLinkResponseModel = {
    listResponsesForSession: async () => [
      {
        id: 'lr-1',
        invite_id: 'inv-1',
        session_id: 'session-1',
        current_step: 5,
        step1_data: {},
        step2_data: {},
        step3_data: {},
        step4_data: {},
        contribution_style: 'supportive',
        completed_at: '2026-01-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        email: 'manager@example.com',
        display_name: 'Manager',
        survey_role: 'manager',
        manager_invite_id: null,
        manager_display_name: null,
        manager_email: null,
      },
    ],
  };

  const out = await listSessionResponses('session-1', {
    employeeResponseModel,
    pulseLinkResponseModel,
  });
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[0].source_type, 'employee');
  assert.equal(out.rows[1].source_type, 'pulse_link');
  assert.equal(out.rows[1].role, 'admin');
  assert.deepEqual(out.responseContract.cohortsIncluded, ['employee', 'pulse_link']);
  assert.equal(out.responseContract.includesLinkInviteRespondents, true);
});
