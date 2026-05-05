import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LICENSE_TIERS,
  LICENSE_STATUSES,
  defaultsForTier,
  isLicenseActive,
  isUnlimitedAssessments,
  assessmentsRemaining,
  publicLicenseConfig,
} from './LicenseConfig.js';

test('LICENSE_TIERS exposes the four supported tiers', () => {
  assert.deepEqual(LICENSE_TIERS, [
    'practitioner',
    'enterprise_mid',
    'enterprise_large',
    'enterprise_unlimited',
  ]);
});

test('LICENSE_STATUSES exposes the supported statuses', () => {
  assert.deepEqual(LICENSE_STATUSES, ['active', 'suspended', 'expired']);
});

test('defaultsForTier returns sensible defaults per tier', () => {
  assert.deepEqual(defaultsForTier('practitioner'), {
    adminUserLimit: 5,
    assessmentsIncluded: 4,
    respondentCap: 50,
  });
  assert.equal(defaultsForTier('enterprise_unlimited').adminUserLimit, 100);
  assert.equal(defaultsForTier('something-unknown').adminUserLimit, 5);
});

test('isLicenseActive treats missing rows as active and respects status/contract end', () => {
  assert.equal(isLicenseActive(null), true);
  assert.equal(isLicenseActive({ status: 'active' }), true);
  assert.equal(isLicenseActive({ status: 'suspended' }), false);
  assert.equal(isLicenseActive({ status: 'expired' }), false);
  const past = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
  assert.equal(isLicenseActive({ status: 'active', contract_end: past }), false);
  const future = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
  assert.equal(isLicenseActive({ status: 'active', contract_end: future }), true);
});

test('publicLicenseConfig serialises the row to camelCase', () => {
  const row = {
    organization_id: 'org-1',
    licence_tier: 'enterprise_mid',
    status: 'active',
    contract_start: '2026-01-01T00:00:00.000Z',
    contract_end: '2027-01-01T00:00:00.000Z',
    assessments_included: 12,
    assessments_consumed: 3,
    respondent_cap_per_assessment: 250,
    admin_user_limit: 10,
    benchmark_access: true,
    onboarding_fee_paid: false,
    notes: 'first cohort',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
  };
  assert.deepEqual(publicLicenseConfig(row), {
    organizationId: 'org-1',
    licenseTier: 'enterprise_mid',
    status: 'active',
    contractStart: '2026-01-01T00:00:00.000Z',
    contractEnd: '2027-01-01T00:00:00.000Z',
    assessmentsIncluded: 12,
    assessmentsConsumed: 3,
    respondentCapPerAssessment: 250,
    adminUserLimit: 10,
    benchmarkAccess: true,
    onboardingFeePaid: false,
    notes: 'first cohort',
    brandDisplayName: null,
    brandPrimaryColor: null,
    brandUseForDownstream: true,
    scheduledOffboardAt: null,
    purgeAfter: null,
    offboardRequestedBy: null,
    offboardReason: null,
    emailTemplateOverrides: {},
    supportEmail: null,
    supportUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  });
});

test('publicLicenseConfig returns null for null input', () => {
  assert.equal(publicLicenseConfig(null), null);
});

test('isUnlimitedAssessments treats null/zero included as unlimited', () => {
  assert.equal(isUnlimitedAssessments(null), true);
  assert.equal(isUnlimitedAssessments({ assessments_included: 0 }), true);
  assert.equal(isUnlimitedAssessments({ assessments_included: null }), true);
  assert.equal(isUnlimitedAssessments({ assessments_included: 4 }), false);
});

test('assessmentsRemaining respects unlimited and capped tiers', () => {
  assert.equal(assessmentsRemaining(null), Infinity);
  assert.equal(assessmentsRemaining({ assessments_included: 0, assessments_consumed: 0 }), Infinity);
  assert.equal(
    assessmentsRemaining({ assessments_included: 4, assessments_consumed: 1 }),
    3
  );
  assert.equal(
    assessmentsRemaining({ assessments_included: 4, assessments_consumed: 4 }),
    0
  );
  assert.equal(
    assessmentsRemaining({ assessments_included: 4, assessments_consumed: 10 }),
    0
  );
});
