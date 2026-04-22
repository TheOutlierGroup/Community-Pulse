import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssembleReportData } from './reportDataAssembler.js';

function buildSteps(prefix, value) {
  const mk = (start) =>
    Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`${prefix}${start + i}`, value]));
  return {
    step1_data: { answers: mk(1) },
    step2_data: { answers: mk(5) },
    step3_data: { answers: mk(9) },
    step4_data: { answers: mk(13) },
  };
}

function makeRow({ role = 'employee', completedAt = '2026-01-10T10:00:00.000Z', value = 4 } = {}) {
  return {
    role,
    completed_at: completedAt,
    ...buildSteps(role === 'admin' ? 'MQ' : 'Q', value),
  };
}

test('assembleReportData throws INSUFFICIENT_DATA when below minimum', async () => {
  const assembleReportData = createAssembleReportData({
    reportMinResponses: 3,
    reportStageMap: { pre: 'pre', mid: 'during', post: 'completed' },
    pulseSessionModel: {
      async listSessionsForOrg() {
        return [{ id: 's1', session_purpose: 'pre_project' }];
      },
    },
    listSessionResponsesFn: async () => ({ rows: [makeRow()] }),
    userModel: {
      async countActiveUsersByRoleForOrg() {
        return { employee: 10, admin: 2 };
      },
    },
    pulseLinkInviteModel: {
      async listInviteRowsForOrg() {
        return [];
      },
    },
  });

  await assert.rejects(
    () => assembleReportData({ organization: { id: 'org-1', name: 'Client' }, stage: 'pre' }),
    (error) => error?.code === 'INSUFFICIENT_DATA'
  );
});

test('assembleReportData returns stable matrix, percentages, and invite totals for matching stage', async () => {
  const responsesBySession = {
    preA: {
      rows: [
        makeRow({ role: 'employee', value: 4 }),
        makeRow({ role: 'employee', value: 3 }),
        makeRow({ role: 'admin', value: 5 }),
        makeRow({ role: 'admin', value: 4 }),
      ],
    },
    preB: { rows: [makeRow({ role: 'employee', value: 5 }), makeRow({ role: 'admin', value: 3 })] },
    midA: { rows: [makeRow({ role: 'employee', value: 1 })] },
  };

  const assembleReportData = createAssembleReportData({
    reportMinResponses: 2,
    reportStageMap: { pre: 'pre', mid: 'during', post: 'completed' },
    pulseSessionModel: {
      async listSessionsForOrg() {
        return [
          { id: 'preA', session_purpose: 'pre_project' },
          { id: 'preB', session_purpose: 'pre_project' },
          { id: 'midA', session_purpose: 'during_project' },
        ];
      },
    },
    listSessionResponsesFn: async (sessionId) => responsesBySession[sessionId] || { rows: [] },
    userModel: {
      async countActiveUsersByRoleForOrg() {
        return { employee: 10, admin: 2 };
      },
    },
    pulseLinkInviteModel: {
      async listInviteRowsForOrg() {
        return [
          { survey_role: 'employee', manager_display_name: 'Mgr A' },
          { survey_role: 'manager', manager_display_name: 'Mgr A' },
          { survey_role: 'employee', manager_display_name: 'Mgr B' },
        ];
      },
    },
  });

  const out = await assembleReportData({
    organization: { id: 'org-1', name: 'Client A', slug: 'client-a' },
    stage: 'pre',
  });

  assert.equal(out.stage, 'pre');
  assert.equal(out.totals.responses, 6); // only pre sessions
  assert.equal(out.totals.invited, 15); // 10+2 + (2 staff +1 manager)
  assert.equal(out.manager.load_distribution.reduce((sum, row) => sum + row.percent, 0), 100);
  assert.equal(
    out.manager.sponsorship_chain_distribution.reduce((sum, row) => sum + row.percent, 0),
    100
  );
  assert.equal(out.manager.load_chain_matrix.length, 4);
  assert.equal(out.manager.load_chain_matrix[0].cells.length, 4);
  assert.ok(Array.isArray(out.alerts));
  assert.ok(out.readiness.verdict);
});
