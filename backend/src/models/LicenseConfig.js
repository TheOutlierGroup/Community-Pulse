import { query } from '../config/database.js';

export const LICENSE_TIERS = [
  'practitioner',
  'enterprise_mid',
  'enterprise_large',
  'enterprise_unlimited',
];

export const LICENSE_STATUSES = ['active', 'suspended', 'expired'];

const TIER_DEFAULTS = {
  practitioner: { adminUserLimit: 5, assessmentsIncluded: 4, respondentCap: 50 },
  enterprise_mid: { adminUserLimit: 10, assessmentsIncluded: 12, respondentCap: 250 },
  enterprise_large: { adminUserLimit: 25, assessmentsIncluded: 40, respondentCap: 1000 },
  enterprise_unlimited: { adminUserLimit: 100, assessmentsIncluded: 0, respondentCap: null },
};

export function defaultsForTier(tier) {
  return TIER_DEFAULTS[tier] || TIER_DEFAULTS.practitioner;
}

function publicRow(row) {
  if (!row) return null;
  return {
    organizationId: row.organization_id,
    licenseTier: row.licence_tier,
    status: row.status,
    contractStart: row.contract_start,
    contractEnd: row.contract_end,
    assessmentsIncluded: row.assessments_included,
    assessmentsConsumed: row.assessments_consumed,
    respondentCapPerAssessment: row.respondent_cap_per_assessment,
    adminUserLimit: row.admin_user_limit,
    benchmarkAccess: Boolean(row.benchmark_access),
    onboardingFeePaid: Boolean(row.onboarding_fee_paid),
    notes: row.notes,
    brandDisplayName: row.brand_display_name || null,
    brandPrimaryColor: row.brand_primary_color || null,
    brandUseForDownstream: row.brand_use_for_downstream !== false,
    scheduledOffboardAt: row.scheduled_offboard_at || null,
    purgeAfter: row.purge_after || null,
    offboardRequestedBy: row.offboard_requested_by || null,
    offboardReason: row.offboard_reason || null,
    emailTemplateOverrides: row.email_template_overrides || {},
    supportEmail: row.support_email || null,
    supportUrl: row.support_url || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * DAT-03 schedule helper. Flips the licence to suspended and stamps
 * the scheduled-purge timestamps in a single statement so callers can't
 * accidentally end up half-off-boarded.
 */
export async function scheduleOffboard(organizationId, { reason = null, requestedBy = null, graceDays = 30 } = {}) {
  if (!organizationId) return null;
  const grace = Number.isInteger(graceDays) && graceDays >= 0 ? graceDays : 30;
  const purgeAfter = new Date(Date.now() + grace * 24 * 60 * 60 * 1000).toISOString();
  const { rows } = await query(
    `UPDATE licence_config
       SET status = 'suspended',
           scheduled_offboard_at = NOW(),
           purge_after = $2,
           offboard_requested_by = $3,
           offboard_reason = $4,
           updated_at = NOW()
     WHERE organization_id = $1
     RETURNING *`,
    [organizationId, purgeAfter, requestedBy, reason]
  );
  return rows[0] || null;
}

/**
 * DAT-03 cancel helper — undo a scheduled off-board, returning the
 * licence to active. Only safe to call before the cron has actually
 * purged; it's a no-op if `purge_after` is null.
 */
export async function cancelScheduledOffboard(organizationId) {
  if (!organizationId) return null;
  const { rows } = await query(
    `UPDATE licence_config
       SET status = 'active',
           scheduled_offboard_at = NULL,
           purge_after = NULL,
           offboard_requested_by = NULL,
           offboard_reason = NULL,
           updated_at = NOW()
     WHERE organization_id = $1
     RETURNING *`,
    [organizationId]
  );
  return rows[0] || null;
}

/**
 * DAT-03 cron query — find all licensee orgs whose off-board grace has
 * elapsed and which are therefore eligible for hard delete.
 */
export async function findOffboardsDueForPurge(now = new Date()) {
  const { rows } = await query(
    `SELECT lc.organization_id, lc.purge_after, lc.offboard_reason, o.name AS organization_name
     FROM licence_config lc
     JOIN organizations o ON o.id = lc.organization_id
     WHERE lc.purge_after IS NOT NULL
       AND lc.purge_after <= $1
       AND o.kind = 'licensee'`,
    [now.toISOString()]
  );
  return rows;
}

export async function getForOrganization(organizationId) {
  if (!organizationId) return null;
  const { rows } = await query(
    `SELECT * FROM licence_config WHERE organization_id = $1`,
    [organizationId]
  );
  return rows[0] || null;
}

export async function publicForOrganization(organizationId) {
  const row = await getForOrganization(organizationId);
  return publicRow(row);
}

export async function createDefaultForLicensee(organizationId, { tier = 'practitioner' } = {}) {
  if (!organizationId) return null;
  const defaults = defaultsForTier(tier);
  const { rows } = await query(
    `INSERT INTO licence_config (
       organization_id,
       licence_tier,
       status,
       admin_user_limit,
       assessments_included,
       respondent_cap_per_assessment
     )
     VALUES ($1, $2, 'active', $3, $4, $5)
     ON CONFLICT (organization_id) DO NOTHING
     RETURNING *`,
    [
      organizationId,
      tier,
      defaults.adminUserLimit,
      defaults.assessmentsIncluded,
      defaults.respondentCap,
    ]
  );
  return rows[0] || (await getForOrganization(organizationId));
}

export async function updateForOrganization(organizationId, patch = {}) {
  if (!organizationId) return null;
  const fields = [];
  const params = [organizationId];
  const map = {
    licenseTier: 'licence_tier',
    status: 'status',
    contractStart: 'contract_start',
    contractEnd: 'contract_end',
    assessmentsIncluded: 'assessments_included',
    assessmentsConsumed: 'assessments_consumed',
    respondentCapPerAssessment: 'respondent_cap_per_assessment',
    adminUserLimit: 'admin_user_limit',
    benchmarkAccess: 'benchmark_access',
    onboardingFeePaid: 'onboarding_fee_paid',
    notes: 'notes',
    brandDisplayName: 'brand_display_name',
    brandPrimaryColor: 'brand_primary_color',
    brandUseForDownstream: 'brand_use_for_downstream',
    emailTemplateOverrides: 'email_template_overrides',
    supportEmail: 'support_email',
    supportUrl: 'support_url',
  };
  for (const [key, column] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      // JSONB columns need explicit cast and JSON-stringification.
      if (column === 'email_template_overrides') {
        params.push(JSON.stringify(patch[key] || {}));
        fields.push(`${column} = $${params.length}::jsonb`);
      } else {
        params.push(patch[key]);
        fields.push(`${column} = $${params.length}`);
      }
    }
  }
  if (!fields.length) {
    return getForOrganization(organizationId);
  }
  fields.push(`updated_at = NOW()`);
  const { rows } = await query(
    `UPDATE licence_config
     SET ${fields.join(', ')}
     WHERE organization_id = $1
     RETURNING *`,
    params
  );
  return rows[0] || null;
}

export async function incrementAssessmentsConsumed(organizationId, by = 1) {
  if (!organizationId) return null;
  const { rows } = await query(
    `UPDATE licence_config
     SET assessments_consumed = assessments_consumed + $2,
         updated_at = NOW()
     WHERE organization_id = $1
     RETURNING *`,
    [organizationId, by]
  );
  return rows[0] || null;
}

export function isUnlimitedAssessments(row) {
  // assessments_included = 0 is the encoded "unlimited" marker, used by
  // enterprise_unlimited tier and any legacy row that hasn't been sized.
  return !row || row.assessments_included == null || row.assessments_included === 0;
}

export function assessmentsRemaining(row) {
  if (!row || isUnlimitedAssessments(row)) return Infinity;
  const remaining = (row.assessments_included || 0) - (row.assessments_consumed || 0);
  return remaining > 0 ? remaining : 0;
}

/**
 * Atomic meter for INF-04. Charges `by` assessments against a licensee's
 * quota in a single conditional UPDATE so two concurrent "open assessment"
 * requests can't both squeak through when only one slot remains. Returns
 * `{ ok: true, row }` on success or `{ ok: false, reason, row }` on
 * quota_exceeded / suspended / expired / no_config.
 */
export async function tryConsumeAssessment(organizationId, by = 1) {
  if (!organizationId) return { ok: false, reason: 'no_config', row: null };
  const charge = Number.isFinite(by) && by > 0 ? Math.floor(by) : 1;
  const config = await getForOrganization(organizationId);
  if (!config) return { ok: false, reason: 'no_config', row: null };
  if (!isLicenseActive(config)) {
    const reason = config.status === 'suspended'
      ? 'suspended'
      : config.status === 'expired'
        ? 'expired'
        : 'expired';
    return { ok: false, reason, row: config };
  }
  if (isUnlimitedAssessments(config)) {
    const updated = await incrementAssessmentsConsumed(organizationId, charge);
    return { ok: true, row: updated || config };
  }
  // Conditional update keeps cap enforcement atomic under concurrency.
  const { rows } = await query(
    `UPDATE licence_config
     SET assessments_consumed = assessments_consumed + $2,
         updated_at = NOW()
     WHERE organization_id = $1
       AND assessments_consumed + $2 <= assessments_included
     RETURNING *`,
    [organizationId, charge]
  );
  if (rows.length === 0) {
    return { ok: false, reason: 'quota_exceeded', row: config };
  }
  return { ok: true, row: rows[0] };
}

export function isLicenseActive(row) {
  if (!row) return true;
  if (row.status !== 'active') return false;
  if (row.contract_end && new Date(row.contract_end).getTime() < Date.now()) {
    return false;
  }
  return true;
}

export function publicLicenseConfig(row) {
  return publicRow(row);
}
