import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectStaffInvitesNeedingManagerRole,
  responseHasManagerAnswerSignature,
} from './pulseLinkRoleRepair.js';

test('responseHasManagerAnswerSignature detects MQ answers in any step', () => {
  const row = {
    step1_data: { answers: { Q1: 4 } },
    step2_data: { answers: { MQ7: 5 } },
    step3_data: {},
    step4_data: null,
  };
  assert.equal(responseHasManagerAnswerSignature(row), true);
});

test('responseHasManagerAnswerSignature ignores staff-only answers', () => {
  const row = {
    step1_data: { answers: { Q1: 4, Q2: 3 } },
    step2_data: { answers: { Q3: 5 } },
    step3_data: { answers: { Q4: 2 } },
    step4_data: { answers: { Q5: 1 } },
  };
  assert.equal(responseHasManagerAnswerSignature(row), false);
});

test('collectStaffInvitesNeedingManagerRole aggregates and filters candidates', () => {
  const rows = [
    {
      invite_id: 'invite-1',
      email: 'manager.one@example.com',
      display_name: 'Manager One',
      timepoint_phase: 'pre',
      completed_at: '2026-04-01T10:00:00.000Z',
      step1_data: { answers: { MQ1: 4 } },
      step2_data: {},
      step3_data: {},
      step4_data: {},
    },
    {
      invite_id: 'invite-1',
      email: 'manager.one@example.com',
      display_name: 'Manager One',
      timepoint_phase: 'pre',
      completed_at: null,
      step1_data: { answers: { MQ2: 4 } },
      step2_data: {},
      step3_data: {},
      step4_data: {},
    },
    {
      invite_id: 'invite-2',
      email: 'staff@example.com',
      display_name: 'Staff User',
      timepoint_phase: 'pre',
      completed_at: '2026-04-01T11:00:00.000Z',
      step1_data: { answers: { Q1: 4 } },
      step2_data: {},
      step3_data: {},
      step4_data: {},
    },
  ];

  const result = collectStaffInvitesNeedingManagerRole(rows);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    inviteId: 'invite-1',
    email: 'manager.one@example.com',
    displayName: 'Manager One',
    timepointPhase: 'pre',
    responseCount: 2,
    completedResponseCount: 1,
    managerSignalResponseCount: 2,
    lastCompletedAt: '2026-04-01T10:00:00.000Z',
  });
});
