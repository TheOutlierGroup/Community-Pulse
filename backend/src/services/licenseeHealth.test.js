import test from 'node:test';
import assert from 'node:assert/strict';
import { summariseLicensee } from './licenseeHealth.js';

const baseOrg = { id: 'org-1', name: 'Acme Licensee', kind: 'licensee', parent_organization_id: null };

test('summariseLicensee marks healthy when active recently and within quota', () => {
  const out = summariseLicensee({
    organization: baseOrg,
    licenceConfig: {
      licence_status: 'active',
      contract_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      assessments_consumed: 10,
      assessments_included: 100,
    },
    lastLoginAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    activeAdmins: 1,
    activeMembers: 4,
    recentActivityCount: 12,
    recentActivityAt: new Date().toISOString(),
  });
  assert.equal(out.healthStatus, 'healthy');
  assert.equal(out.quotaBurnPct, 10);
});

test('summariseLicensee flags quota_exhausted when consumed >= included', () => {
  const out = summariseLicensee({
    organization: baseOrg,
    licenceConfig: {
      licence_status: 'active',
      assessments_consumed: 50,
      assessments_included: 50,
    },
    lastLoginAt: new Date().toISOString(),
    activeAdmins: 1,
    activeMembers: 0,
    recentActivityCount: 1,
  });
  assert.equal(out.healthStatus, 'quota_exhausted');
  assert.equal(out.quotaBurnPct, 100);
});

test('summariseLicensee flags expired when contract_end is in the past', () => {
  const out = summariseLicensee({
    organization: baseOrg,
    licenceConfig: {
      licence_status: 'active',
      contract_end: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      assessments_consumed: 1,
      assessments_included: 100,
    },
    lastLoginAt: new Date().toISOString(),
  });
  assert.equal(out.healthStatus, 'expired');
});

test('summariseLicensee uses the licence_status when not active (e.g. suspended)', () => {
  const out = summariseLicensee({
    organization: baseOrg,
    licenceConfig: { licence_status: 'suspended', assessments_consumed: 1, assessments_included: 100 },
    lastLoginAt: new Date().toISOString(),
  });
  assert.equal(out.healthStatus, 'suspended');
});

test('summariseLicensee marks inactive when last login is older than 30 days', () => {
  const out = summariseLicensee({
    organization: baseOrg,
    licenceConfig: { licence_status: 'active', assessments_consumed: 0, assessments_included: 100 },
    lastLoginAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
  });
  assert.equal(out.healthStatus, 'inactive');
});

test('summariseLicensee marks never_logged_in when lastLoginAt is null', () => {
  const out = summariseLicensee({
    organization: baseOrg,
    licenceConfig: { licence_status: 'active', assessments_consumed: 0, assessments_included: 100 },
    lastLoginAt: null,
  });
  assert.equal(out.healthStatus, 'never_logged_in');
});

test('summariseLicensee returns unmanaged when no licence_config row exists', () => {
  const out = summariseLicensee({
    organization: baseOrg,
    licenceConfig: null,
    lastLoginAt: new Date().toISOString(),
  });
  assert.equal(out.healthStatus, 'unmanaged');
  assert.equal(out.quotaBurnPct, null);
});
