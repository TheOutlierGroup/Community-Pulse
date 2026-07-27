import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssembleReportData } from './reportDataAssembler.js';
import { DASHBOARD_MIN_SAMPLE_SIZE } from './pulseDashboardScope.js';

/**
 * PT-01 regression cover.
 *
 * REPORT_MIN_RESPONSES gates the report on the org-wide response total,
 * which says nothing about the size of the cohort any individual
 * breakdown actually averages over. Before this fix, a report clearing
 * that org-wide floor still published per-team scores for teams of one,
 * a named team's lead-manager load band, and manager-cohort aggregates
 * derived from two people — the same filter-down disclosure RED-022
 * closed on the dashboard, reachable through Generate Report instead.
 */

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

function makeRow({
  role = 'employee',
  value = 4,
  inviteId = null,
  managerInviteId = null,
} = {}) {
  return {
    role,
    completed_at: '2026-01-10T10:00:00.000Z',
    invite_id: inviteId,
    manager_invite_id: managerInviteId,
    ...buildSteps(role === 'admin' ? 'MQ' : 'Q', value),
  };
}

function invite({ id, role = 'staff', team, managerName = null }) {
  return {
    id,
    survey_role: role,
    group_level_values: team ? ['Division', team] : [],
    display_name: managerName || `${role}-${id}`,
    manager_display_name: managerName,
  };
}

function assemble({ rows, invites, minSampleSize = DASHBOARD_MIN_SAMPLE_SIZE }) {
  const assembleReportData = createAssembleReportData({
    reportMinResponses: 4,
    minSampleSize,
    reportStageMap: { pre: 'pre', mid: 'during', post: 'completed' },
    pulseSessionModel: {
      async listSessionsForOrg() {
        return [{ id: 's1', session_purpose: 'pre_project' }];
      },
    },
    listSessionResponsesFn: async () => ({ rows }),
    userModel: {
      async countActiveUsersByRoleForOrg() {
        return { employee: 10, admin: 2 };
      },
    },
    pulseLinkInviteModel: {
      async listInviteRowsForOrg() {
        return invites;
      },
    },
  });
  return assembleReportData({
    organization: { id: 'org-1', name: 'Client', settings: {} },
    stage: 'pre',
  });
}

/** Six staff on Big Team, one lone respondent on Small Team. */
function mixedTeamFixture() {
  const invites = [
    invite({ id: 'mgr-big', role: 'manager', team: 'Big Team' }),
    invite({ id: 'mgr-small', role: 'manager', team: 'Small Team' }),
  ];
  const rows = [
    ...Array.from({ length: 6 }, () =>
      makeRow({ role: 'employee', value: 4, managerInviteId: 'mgr-big' })
    ),
    makeRow({ role: 'employee', value: 2, managerInviteId: 'mgr-small' }),
  ];
  return { rows, invites };
}

test('PT-01: a team below the sample floor has every derived value withheld', async () => {
  const data = await assemble(mixedTeamFixture());
  const small = data.teams.find((t) => t.name === 'Small Team');

  assert.ok(small, 'the team should still be listed');
  assert.equal(small.sample_size_met, false);
  assert.equal(small.response_count, 1, 'counts stay, to explain the suppression');
  assert.equal(small.adoption_score, null);
  assert.equal(small.sponsorship_score, null);
  assert.equal(small.quadrant, null);
  assert.equal(small.quadrant_label, null);
  // A bare 'LOW' against a null score still discloses which side of the
  // threshold the team sits on.
  assert.equal(small.adoption_status, null);
  assert.equal(small.sponsorship_status, null);
});

test('PT-01: a team above the floor still reports its scores', async () => {
  const data = await assemble(mixedTeamFixture());
  const big = data.teams.find((t) => t.name === 'Big Team');

  assert.equal(big.sample_size_met, true);
  assert.equal(typeof big.adoption_score, 'number');
  assert.equal(typeof big.sponsorship_score, 'number');
  assert.ok(big.quadrant, 'quadrant should be present above the floor');
});

test("PT-01: a suppressed team never exposes its lead manager's load band", async () => {
  // The manager's own self-response is n=1 by construction, so on a
  // suppressed row it would identify one named person outright.
  const invites = [invite({ id: 'mgr-solo', role: 'manager', team: 'Solo Team' })];
  const rows = [
    makeRow({ role: 'admin', value: 2, inviteId: 'mgr-solo' }),
    ...Array.from({ length: 4 }, () => makeRow({ role: 'employee', value: 4 })),
  ];

  const data = await assemble({ rows, invites });
  const solo = data.teams.find((t) => t.name === 'Solo Team');

  assert.equal(solo.sample_size_met, false);
  assert.equal(solo.manager_load_band, null, 'lead manager load band must be withheld');
});

test('PT-01: manager-cohort aggregates are withheld when too few managers responded', async () => {
  // 10 staff + 2 managers clears an org-wide floor of 4 while the manager
  // cohort is still two identifiable people.
  const rows = [
    ...Array.from({ length: 10 }, () => makeRow({ role: 'employee', value: 4 })),
    makeRow({ role: 'admin', value: 5 }),
    makeRow({ role: 'admin', value: 2 }),
  ];
  const data = await assemble({ rows, invites: [] });

  assert.equal(data.manager.sample_size_met, false);
  assert.equal(data.manager.manager_count, 2, 'the count itself is not a score');
  assert.equal(data.manager.sponsorship_received_avg, null);
  assert.equal(data.manager.sponsorship_capacity_avg, null);

  for (const band of data.manager.load_distribution) {
    assert.equal(band.percent, null, `${band.name} percent must be withheld, not zeroed`);
    assert.equal(band.count, null);
  }
  for (const state of data.manager.sponsorship_chain_distribution) {
    assert.equal(state.percent, null);
  }
  for (const row of data.manager.load_chain_matrix) {
    for (const cell of row.cells) {
      assert.equal(cell.count, null, 'a matrix cell count of 1 pinpoints an individual');
    }
  }

  // Manager dimension averages come from the same two people.
  assert.equal(data.dimensions.manager_sample_size_met, false);
  for (const dimension of data.dimensions.manager) {
    assert.equal(dimension.avg, null);
  }
});

test('PT-01: the manager overload alert cannot fire from a suppressed cohort', async () => {
  // One overloaded manager out of two would otherwise read as "50% of
  // managers are in the Overloaded band".
  const rows = [
    ...Array.from({ length: 10 }, () => makeRow({ role: 'employee', value: 4 })),
    makeRow({ role: 'admin', value: 1 }),
    makeRow({ role: 'admin', value: 1 }),
  ];
  const data = await assemble({ rows, invites: [] });

  assert.equal(data.manager.sample_size_met, false);
  assert.equal(
    data.alerts.some((a) => a.title === 'Manager Overload'),
    false,
    'overload alert must not be derived from a suppressed cohort'
  );
});

test('PT-01: employee dimension averages follow the staff cohort floor', async () => {
  // 3 staff + 6 managers: org-wide total clears the floor, staff cohort
  // does not.
  const rows = [
    ...Array.from({ length: 3 }, () => makeRow({ role: 'employee', value: 4 })),
    ...Array.from({ length: 6 }, () => makeRow({ role: 'admin', value: 4 })),
  ];
  const data = await assemble({ rows, invites: [] });

  assert.equal(data.dimensions.employee_sample_size_met, false);
  for (const dimension of data.dimensions.employee) {
    assert.equal(dimension.avg, null);
  }
  // Derived floors read off those averages, so they fall away too.
  assert.equal(data.dimensions.adoption_floor, null);
  assert.equal(data.dimensions.sponsorship_floor, null);

  // The manager cohort cleared its own floor and is unaffected.
  assert.equal(data.dimensions.manager_sample_size_met, true);
});

test('PT-01: the report uses the same floor as the dashboard', async () => {
  const data = await assemble(mixedTeamFixture());
  assert.equal(data.suppression.min_sample_size, DASHBOARD_MIN_SAMPLE_SIZE);
  assert.equal(data.suppression.suppressed_team_count, 1);
});
