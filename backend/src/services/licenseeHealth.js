import { query } from '../config/database.js';
import * as Organization from '../models/Organization.js';
import * as LicenseConfig from '../models/LicenseConfig.js';

/**
 * Phase 2 support analytics: per-licensee operational health snapshot.
 * Built entirely from existing tables (no new schema):
 *   - last login from `audit_events` (action='auth.login', result='ok')
 *   - active admin / member counts from `users`
 *   - recent activity count from `audit_events`
 *   - quota burn from `licence_config`
 *
 * The snapshot is intentionally cheap (one row per source table) so we
 * can render it inline on PlatformClients without a per-row N+1.
 */

function statusForLicence(config, lastLoginAt) {
  if (!config) return 'unmanaged';
  if (config.licence_status && config.licence_status !== 'active') {
    return String(config.licence_status);
  }
  if (config.contract_end && new Date(config.contract_end) < new Date()) {
    return 'expired';
  }
  if (
    config.assessments_included &&
    config.assessments_consumed != null &&
    config.assessments_consumed >= config.assessments_included
  ) {
    return 'quota_exhausted';
  }
  if (lastLoginAt) {
    const ageMs = Date.now() - new Date(lastLoginAt).getTime();
    if (ageMs > 1000 * 60 * 60 * 24 * 30) return 'inactive';
  } else {
    return 'never_logged_in';
  }
  return 'healthy';
}

export function summariseLicensee({ organization, licenceConfig, lastLoginAt, activeAdmins, activeMembers, recentActivityCount, recentActivityAt }) {
  const consumed = licenceConfig?.assessments_consumed ?? null;
  const included = licenceConfig?.assessments_included ?? null;
  const quotaBurnPct = included && included > 0 && consumed != null
    ? Math.min(100, Math.round((consumed / included) * 1000) / 10)
    : null;
  return {
    organizationId: organization.id,
    organizationName: organization.name,
    kind: organization.kind,
    parentOrganizationId: organization.parent_organization_id || null,
    lastLoginAt: lastLoginAt || null,
    activeAdmins: activeAdmins || 0,
    activeMembers: activeMembers || 0,
    recentActivityCount: recentActivityCount || 0,
    recentActivityAt: recentActivityAt || null,
    licenceStatus: licenceConfig?.licence_status || null,
    contractEnd: licenceConfig?.contract_end || null,
    assessmentsConsumed: consumed,
    assessmentsIncluded: included,
    quotaBurnPct,
    healthStatus: statusForLicence(licenceConfig, lastLoginAt),
  };
}

async function bulkLastLoginByOrg(orgIds) {
  if (orgIds.length === 0) return new Map();
  const { rows } = await query(
    `SELECT target_organization_id AS organization_id,
            MAX(occurred_at) AS last_login_at
     FROM audit_events
     WHERE action = 'auth.login'
       AND result = 'ok'
       AND target_organization_id = ANY($1::uuid[])
     GROUP BY target_organization_id`,
    [orgIds]
  );
  return new Map(rows.map((r) => [r.organization_id, r.last_login_at]));
}

async function bulkActiveUserCountsByOrg(orgIds) {
  if (orgIds.length === 0) return new Map();
  const { rows } = await query(
    `SELECT organization_id,
            COUNT(*) FILTER (WHERE role = 'admin') AS admins,
            COUNT(*) FILTER (WHERE role <> 'admin') AS members
     FROM users
     WHERE deactivated_at IS NULL
       AND organization_id = ANY($1::uuid[])
     GROUP BY organization_id`,
    [orgIds]
  );
  return new Map(rows.map((r) => [r.organization_id, { admins: Number(r.admins), members: Number(r.members) }]));
}

async function bulkRecentActivityByOrg(orgIds, sinceIso) {
  if (orgIds.length === 0) return new Map();
  const { rows } = await query(
    `SELECT target_organization_id AS organization_id,
            COUNT(*) AS event_count,
            MAX(occurred_at) AS last_activity_at
     FROM audit_events
     WHERE target_organization_id = ANY($1::uuid[])
       AND occurred_at >= $2
     GROUP BY target_organization_id`,
    [orgIds, sinceIso]
  );
  return new Map(
    rows.map((r) => [
      r.organization_id,
      { count: Number(r.event_count), lastAt: r.last_activity_at },
    ])
  );
}

async function bulkLicenceConfigByOrg(orgIds) {
  if (orgIds.length === 0) return new Map();
  const { rows } = await query(
    `SELECT * FROM licence_config WHERE organization_id = ANY($1::uuid[])`,
    [orgIds]
  );
  return new Map(rows.map((r) => [r.organization_id, r]));
}

export async function getLicenseeHealthSnapshot({ recentWindowDays = 30 } = {}) {
  const licensees = await Organization.listOrganizationsByKind('licensee');
  const orgIds = licensees.map((o) => o.id);
  const since = new Date(Date.now() - recentWindowDays * 24 * 60 * 60 * 1000).toISOString();

  const [lastLoginByOrg, userCountsByOrg, recentByOrg, configByOrg] = await Promise.all([
    bulkLastLoginByOrg(orgIds),
    bulkActiveUserCountsByOrg(orgIds),
    bulkRecentActivityByOrg(orgIds, since),
    bulkLicenceConfigByOrg(orgIds),
  ]);

  return licensees.map((organization) => {
    const recent = recentByOrg.get(organization.id) || { count: 0, lastAt: null };
    const counts = userCountsByOrg.get(organization.id) || { admins: 0, members: 0 };
    return summariseLicensee({
      organization,
      licenceConfig: configByOrg.get(organization.id) || null,
      lastLoginAt: lastLoginByOrg.get(organization.id) || null,
      activeAdmins: counts.admins,
      activeMembers: counts.members,
      recentActivityCount: recent.count,
      recentActivityAt: recent.lastAt,
    });
  });
}

export async function getLicenseeHealthForOrg(organizationId, { recentWindowDays = 30 } = {}) {
  const organization = await Organization.getOrganization(organizationId);
  if (!organization) return null;
  const since = new Date(Date.now() - recentWindowDays * 24 * 60 * 60 * 1000).toISOString();

  const [lastLoginByOrg, userCountsByOrg, recentByOrg, licenceConfig] = await Promise.all([
    bulkLastLoginByOrg([organization.id]),
    bulkActiveUserCountsByOrg([organization.id]),
    bulkRecentActivityByOrg([organization.id], since),
    LicenseConfig.getForOrganization(organization.id),
  ]);

  const recent = recentByOrg.get(organization.id) || { count: 0, lastAt: null };
  const counts = userCountsByOrg.get(organization.id) || { admins: 0, members: 0 };
  return summariseLicensee({
    organization,
    licenceConfig,
    lastLoginAt: lastLoginByOrg.get(organization.id) || null,
    activeAdmins: counts.admins,
    activeMembers: counts.members,
    recentActivityCount: recent.count,
    recentActivityAt: recent.lastAt,
  });
}
