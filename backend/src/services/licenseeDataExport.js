import * as Organization from '../models/Organization.js';
import * as User from '../models/User.js';
import * as LicenseConfig from '../models/LicenseConfig.js';
import * as AssessmentConsumptionEvent from '../models/AssessmentConsumptionEvent.js';
import * as LicenseExpiryNotification from '../models/LicenseExpiryNotification.js';
import { listRecentAuditEvents, publicAuditEvent } from './auditLog.js';

/**
 * DAT-02 portability bundle for a licensee.
 *
 * Returns one JSON document containing:
 *   - the licensee organisation
 *   - the licence_config row (incl. brand)
 *   - active users (admins + members) with public fields only
 *   - downstream client orgs (without their nested user lists — those
 *     belong to the client's own export, kept separate to avoid
 *     accidental cross-pollination)
 *   - assessment consumption ledger (capped to recent 1k for first cut;
 *     Phase 2 reconciliation already covers month-by-month CSV)
 *   - licence expiry notification history
 *   - audit events scoped to this org (recent 1k)
 *
 * NOT included (intentional):
 *   - password hashes, MFA secrets, recovery codes
 *   - JWT secrets / tokens
 *   - personal pulse responses (those live under each downstream
 *     client's data sovereignty, not the licensee's)
 *
 * Returns `null` for non-licensee orgs so the route layer can 404.
 */

const RECENT_LIMIT = 1000;

function publicUserExport(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    createdAt: row.created_at,
    loginEnabled: row.login_enabled !== false,
  };
}

function publicClientOrgExport(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    parentOrganizationId: row.parent_organization_id || null,
    settings: row.settings || {},
    clientStatus: row.client_status || null,
    createdAt: row.created_at,
    hasLogo: Boolean(row.company_logo_filename),
  };
}

export async function buildLicenseeDataExport(licenseeOrganizationId) {
  const organization = await Organization.getOrganization(licenseeOrganizationId);
  if (!organization || organization.kind !== 'licensee') return null;

  const [licenceConfig, users, clients, assessments, expiryNotifications, auditEvents] =
    await Promise.all([
      LicenseConfig.getForOrganization(organization.id),
      User.listUsersForOrg(organization.id, { limit: 500 }),
      Organization.listClientOrganizationsForParent(organization.id, { limit: 500 }),
      AssessmentConsumptionEvent.listForLicensee(organization.id, { limit: RECENT_LIMIT }),
      LicenseExpiryNotification.listForOrganization(organization.id, { limit: RECENT_LIMIT }),
      listRecentAuditEvents({ organizationId: organization.id, limit: RECENT_LIMIT }),
    ]);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      kind: organization.kind,
      parentOrganizationId: organization.parent_organization_id || null,
      settings: organization.settings || {},
      createdAt: organization.created_at,
      hasLogo: Boolean(organization.company_logo_filename),
    },
    licenceConfig: licenceConfig ? LicenseConfig.publicLicenseConfig(licenceConfig) : null,
    users: (users || []).map(publicUserExport),
    downstreamClients: (clients || []).map(publicClientOrgExport),
    assessmentLedger: (assessments || []).map(AssessmentConsumptionEvent.publicEvent),
    expiryNotifications: (expiryNotifications || []).map(LicenseExpiryNotification.publicNotification),
    auditEvents: (auditEvents || []).map(publicAuditEvent),
    counts: {
      users: users?.length || 0,
      downstreamClients: clients?.length || 0,
      assessmentLedger: assessments?.length || 0,
      expiryNotifications: expiryNotifications?.length || 0,
      auditEvents: auditEvents?.length || 0,
    },
  };
}
