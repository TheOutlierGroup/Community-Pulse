import test from 'node:test';
import assert from 'node:assert/strict';
import { summariseLicenseeOnboarding } from './licenseeOnboarding.js';

const baseUser = { id: 'admin-1', role: 'admin', organizationId: 'org-licensee-1' };
const baseOrg = { id: 'org-licensee-1', kind: 'licensee', name: 'Acme', company_logo_filename: null };

function summarise(overrides = {}) {
  return summariseLicenseeOnboarding({
    user: baseUser,
    organization: baseOrg,
    licenceConfig: null,
    activeUsers: [baseUser],
    downstreamClients: [],
    assessments: [],
    ...overrides,
  });
}

test('returns null when caller is not a licensee org', () => {
  const out = summarise({ organization: { ...baseOrg, kind: 'platform' } });
  assert.equal(out, null);
});

test('all steps incomplete when state is empty', () => {
  const out = summarise();
  assert.equal(out.completed, 0);
  assert.equal(out.total, out.steps.length);
  assert.equal(out.isComplete, false);
});

test('marks confirm_licence done only when assessments_included or contract_end is set', () => {
  const out = summarise({
    licenceConfig: { assessments_included: 100, contract_end: null, brand_primary_color: null },
  });
  assert.equal(out.steps.find((s) => s.id === 'confirm_licence').completed, true);
});

test('marks confirm_licence NOT done when row exists but only defaults', () => {
  const out = summarise({
    licenceConfig: { assessments_included: null, contract_end: null, brand_primary_color: null },
  });
  assert.equal(out.steps.find((s) => s.id === 'confirm_licence').completed, false);
});

test('marks invite_teammate done only when at least one *other* admin is active', () => {
  const onlySelf = summarise();
  assert.equal(onlySelf.steps.find((s) => s.id === 'invite_teammate').completed, false);

  const withTeammate = summarise({
    activeUsers: [
      baseUser,
      { id: 'admin-2', role: 'admin', deactivated_at: null, login_enabled: true },
    ],
  });
  assert.equal(withTeammate.steps.find((s) => s.id === 'invite_teammate').completed, true);
});

test('teammate must have login_enabled !== false', () => {
  const out = summarise({
    activeUsers: [
      baseUser,
      { id: 'admin-2', role: 'admin', deactivated_at: null, login_enabled: false },
    ],
  });
  assert.equal(out.steps.find((s) => s.id === 'invite_teammate').completed, false);
});

test('marks all six steps complete when every signal is present', () => {
  const out = summarise({
    organization: { ...baseOrg, company_logo_filename: 'logo.png' },
    licenceConfig: {
      assessments_included: 100,
      contract_end: '2027-01-01',
      brand_primary_color: '#ea580c',
    },
    activeUsers: [
      baseUser,
      { id: 'admin-2', role: 'admin', deactivated_at: null, login_enabled: true },
    ],
    downstreamClients: [{ id: 'client-1' }],
    assessments: [{ id: 'event-1' }],
  });
  assert.equal(out.completed, 6);
  assert.equal(out.isComplete, true);
});

test('checklist preserves documented step order', () => {
  const out = summarise();
  assert.deepEqual(out.steps.map((s) => s.id), [
    'confirm_licence',
    'upload_logo',
    'set_brand_color',
    'invite_teammate',
    'create_first_client',
    'open_first_assessment',
  ]);
});
