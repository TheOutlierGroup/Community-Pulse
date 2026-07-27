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
  // The manager cohort deliberately clears DASHBOARD_MIN_SAMPLE_SIZE (5).
  // This test asserts the load/chain percentages sum to 100, which only
  // has meaning when those percentages are actually reported — below the
  // floor they are withheld as null by design (PT-01). Suppression
  // behaviour itself is covered in reportDataAssembler.suppression.test.js.
  const responsesBySession = {
    preA: {
      rows: [
        makeRow({ role: 'employee', value: 4 }),
        makeRow({ role: 'employee', value: 3 }),
        makeRow({ role: 'admin', value: 5 }),
        makeRow({ role: 'admin', value: 4 }),
        makeRow({ role: 'admin', value: 4 }),
        makeRow({ role: 'admin', value: 2 }),
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
  assert.equal(out.totals.responses, 8); // only pre sessions (3 staff + 5 managers)
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
  assert.ok(Array.isArray(out.teams));
});

test('assembleReportData names teams from group_level_values, not manager personal name', async () => {
  // Two staff respondents and a manager, all on the "Backend" team
  // ('Engineering > Backend' in group_level_values). Manager Mike is
  // the team lead; the breakdown should be keyed by 'Backend', not 'Mike'.
  const responses = [
    { id: 'r1', invite_id: 'staff-1', manager_invite_id: 'mgr-1', role: 'employee', source_type: 'pulse_link', completed_at: '2026-01-10T10:00:00.000Z', ...buildSteps('Q', 4) },
    { id: 'r2', invite_id: 'staff-2', manager_invite_id: 'mgr-1', role: 'employee', source_type: 'pulse_link', completed_at: '2026-01-10T10:00:00.000Z', ...buildSteps('Q', 3) },
    { id: 'r3', invite_id: 'mgr-1', manager_invite_id: null, role: 'admin', source_type: 'pulse_link', completed_at: '2026-01-10T10:00:00.000Z', ...buildSteps('MQ', 5) },
  ];

  const assembleReportData = createAssembleReportData({
    reportMinResponses: 2,
    reportStageMap: { pre: 'pre', mid: 'during', post: 'completed' },
    pulseSessionModel: {
      async listSessionsForOrg() {
        return [{ id: 's1', session_purpose: 'pre_project' }];
      },
    },
    listSessionResponsesFn: async () => ({ rows: responses }),
    userModel: { async countActiveUsersByRoleForOrg() { return { employee: 0, admin: 0 }; } },
    pulseLinkInviteModel: {
      async listInviteRowsForOrg() {
        return [
          { id: 'mgr-1', survey_role: 'manager', display_name: 'Mike',
            group_level_values: ['Engineering', 'Backend'], manager_display_name: null },
          { id: 'staff-1', survey_role: 'employee', display_name: 'Sara',
            group_level_values: ['Engineering', 'Backend'], manager_invite_id: 'mgr-1', manager_display_name: 'Mike' },
          { id: 'staff-2', survey_role: 'employee', display_name: 'Sam',
            group_level_values: ['Engineering', 'Backend'], manager_invite_id: 'mgr-1', manager_display_name: 'Mike' },
        ];
      },
    },
  });

  const out = await assembleReportData({
    organization: { id: 'org-1', name: 'Client A' },
    stage: 'pre',
  });

  assert.deepEqual(out.totals.teams_in_scope, 'Backend');
  assert.equal(out.teams.length, 1);
  assert.equal(out.teams[0].name, 'Backend');
  assert.equal(out.teams[0].response_count, 3);
  assert.equal(out.teams[0].employee_count, 2);
  assert.equal(out.teams[0].manager_count, 1);
});

test('assembleReportData populates hierarchy_levels from configured groupLevelLabels', async () => {
  const responses = [
    { id: 'r1', invite_id: 'staff-1', manager_invite_id: 'mgr-1', role: 'employee', source_type: 'pulse_link', completed_at: '2026-01-10T10:00:00.000Z', ...buildSteps('Q', 4) },
    { id: 'r2', invite_id: 'mgr-1', manager_invite_id: null, role: 'admin', source_type: 'pulse_link', completed_at: '2026-01-10T10:00:00.000Z', ...buildSteps('MQ', 5) },
  ];
  const assembleReportData = createAssembleReportData({
    reportMinResponses: 2,
    reportStageMap: { pre: 'pre', mid: 'during', post: 'completed' },
    pulseSessionModel: { async listSessionsForOrg() { return [{ id: 's1', session_purpose: 'pre_project' }]; } },
    listSessionResponsesFn: async () => ({ rows: responses }),
    userModel: { async countActiveUsersByRoleForOrg() { return { employee: 0, admin: 0 }; } },
    pulseLinkInviteModel: { async listInviteRowsForOrg() { return []; } },
  });

  const labelsOut = await assembleReportData({
    organization: {
      id: 'org-1',
      name: 'Client A',
      settings: { groupLevels: 3, groupLevelLabels: ['Division', 'Department', 'Team'] },
    },
    stage: 'pre',
  });
  assert.equal(labelsOut.org.hierarchy_levels, 'Division → Department → Team');

  const countOnlyOut = await assembleReportData({
    organization: {
      id: 'org-1',
      name: 'Client A',
      settings: { groupLevels: 2 },
    },
    stage: 'pre',
  });
  assert.equal(countOnlyOut.org.hierarchy_levels, '2 levels');

  const legacyOut = await assembleReportData({
    organization: {
      id: 'org-1',
      name: 'Client A',
      hierarchy_levels: '4 levels: VP → Director → Manager → IC',
    },
    stage: 'pre',
  });
  assert.equal(legacyOut.org.hierarchy_levels, '4 levels: VP → Director → Manager → IC');

  const emptyOut = await assembleReportData({
    organization: { id: 'org-1', name: 'Client A' },
    stage: 'pre',
  });
  assert.equal(emptyOut.org.hierarchy_levels, null);
});

test('assembleReportData falls back to manager display name when group_level_values is absent', async () => {
  const responses = [
    { id: 'r1', invite_id: 'staff-1', manager_invite_id: 'mgr-1', role: 'employee', source_type: 'pulse_link', completed_at: '2026-01-10T10:00:00.000Z', ...buildSteps('Q', 4) },
    { id: 'r2', invite_id: 'mgr-1', manager_invite_id: null, role: 'admin', source_type: 'pulse_link', completed_at: '2026-01-10T10:00:00.000Z', ...buildSteps('MQ', 5) },
  ];

  const assembleReportData = createAssembleReportData({
    reportMinResponses: 2,
    reportStageMap: { pre: 'pre', mid: 'during', post: 'completed' },
    pulseSessionModel: {
      async listSessionsForOrg() {
        return [{ id: 's1', session_purpose: 'pre_project' }];
      },
    },
    listSessionResponsesFn: async () => ({ rows: responses }),
    userModel: { async countActiveUsersByRoleForOrg() { return { employee: 0, admin: 0 }; } },
    pulseLinkInviteModel: {
      async listInviteRowsForOrg() {
        return [
          { id: 'mgr-1', survey_role: 'manager', display_name: 'Mike', group_level_values: [] },
          { id: 'staff-1', survey_role: 'employee', display_name: 'Sara', group_level_values: [], manager_invite_id: 'mgr-1', manager_display_name: 'Mike' },
        ];
      },
    },
  });

  const out = await assembleReportData({
    organization: { id: 'org-1', name: 'Client A' },
    stage: 'pre',
  });

  assert.equal(out.teams.length, 1);
  assert.equal(out.teams[0].name, 'Mike');
});
