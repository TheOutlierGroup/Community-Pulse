import * as Organization from '../models/Organization.js';
import * as LicenseConfig from '../models/LicenseConfig.js';
import { recordAuditEvent, AUDIT_ACTIONS } from './auditLog.js';

/**
 * DAT-03 destructive purge sweep. Runs as part of the nightly
 * privacy-maintenance job (no separate cron needed). Hard-deletes any
 * licensee org whose 30-day off-board grace has elapsed.
 *
 * Idempotent: once an org is deleted there's no row to find, so re-runs
 * are no-ops. Errors per-licensee are isolated so a single bad org
 * doesn't block the rest of the sweep.
 */
export async function runLicenseePurgeSweep({ now = new Date(), dryRun = false } = {}) {
  const result = {
    ok: true,
    startedAt: new Date().toISOString(),
    dryRun,
    considered: 0,
    purged: [],
    errors: [],
  };
  const due = await LicenseConfig.findOffboardsDueForPurge(now);
  result.considered = due.length;
  for (const row of due) {
    try {
      if (dryRun) {
        result.purged.push({
          organizationId: row.organization_id,
          name: row.organization_name,
          dryRun: true,
        });
        continue;
      }
      await Organization.deleteOrganization(row.organization_id);
      await recordAuditEvent({
        action: AUDIT_ACTIONS.LICENSEE_OFFBOARD_PURGE,
        targetType: 'organization',
        targetId: row.organization_id,
        targetOrganizationId: row.organization_id,
        metadata: {
          organizationName: row.organization_name,
          scheduledPurgeAfter: row.purge_after,
          reason: row.offboard_reason,
        },
      });
      result.purged.push({
        organizationId: row.organization_id,
        name: row.organization_name,
        deleted: true,
      });
    } catch (perOrgErr) {
      console.error('Licensee purge failed for', row.organization_id, perOrgErr);
      result.errors.push({
        organizationId: row.organization_id,
        name: row.organization_name,
        error: perOrgErr?.message || 'unknown',
      });
    }
  }
  result.completedAt = new Date().toISOString();
  return result;
}
