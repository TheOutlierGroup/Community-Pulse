import fs from 'fs';
import * as ClientWorkTask from '../models/ClientWorkTask.js';
import * as ClientProject from '../models/ClientProject.js';
import * as CrmContact from '../models/CrmContact.js';
import { taskImageFilePath, projectFilePath } from '../config/storage.js';
import { recordAuditEvent, AUDIT_ACTIONS } from './auditLog.js';
import { startRetentionJobRun, finishRetentionJobRun } from './retentionPolicy.js';

const JOB_NAME = 'undo_purge_sweep';

function contactLabel(row) {
  return [row.contact_firstname, row.contact_lastname].filter(Boolean).join(' ');
}

async function unlinkQuiet(fullPath) {
  try {
    await fs.promises.unlink(fullPath);
  } catch {
    /* file may already be gone */
  }
}

/**
 * Undo feature's purge sweep — the counterpart to licenseePurge.js, but for
 * the four soft-delete tables (client_work_tasks, client_project_milestones,
 * client_project_files, crm_contacts) instead of whole organizations. Runs
 * as part of the nightly privacy-maintenance job. Hard-deletes any row
 * whose recovery window (purge_after) has elapsed, unlinking on-disk files
 * only at this point — not at soft-delete time — so restore stays a true
 * undo up until the row is actually purged.
 *
 * Idempotent and per-row error-isolated, mirroring runLicenseePurgeSweep.
 * Wrapped in a retention_job_runs heartbeat (job_name: 'undo_purge_sweep'),
 * reusing the same start/finish helpers as the retention sweep.
 */
export async function runUndoPurgeSweep({ now = new Date(), dryRun = false } = {}) {
  const jobRun = await startRetentionJobRun(JOB_NAME, { dryRun });
  try {
    const result = await performUndoPurgeSweep({ now, dryRun });
    await finishRetentionJobRun(jobRun.id, 'ok', {
      recordsScanned: result.considered,
      recordsAnonymized: result.purged.filter((p) => p.deleted).length,
      dryRun,
    });
    return result;
  } catch (error) {
    await finishRetentionJobRun(jobRun.id, 'failed', {
      errorCode: error?.code || 'undo_purge_error',
      errorMessage: error?.message || 'Undo purge sweep failed',
      dryRun,
    });
    throw error;
  }
}

async function performUndoPurgeSweep({ now, dryRun }) {
  const result = {
    ok: true,
    startedAt: new Date().toISOString(),
    dryRun,
    considered: 0,
    purged: [],
    errors: [],
  };

  const due = await ClientWorkTask.findTasksDueForPurge(now);
  for (const row of due) {
    result.considered += 1;
    try {
      if (dryRun) {
        result.purged.push({ entityType: 'client_work_task', id: row.id, name: row.title, dryRun: true });
        continue;
      }
      const filenames = await ClientWorkTask.listAttachmentFilenamesForTask(row.id);
      await ClientWorkTask.hardDeleteTask(row.id);
      await Promise.allSettled(filenames.map((f) => unlinkQuiet(taskImageFilePath(f))));
      await recordAuditEvent({
        action: AUDIT_ACTIONS.UNDO_PURGE_SWEEP,
        targetType: 'client_work_task',
        targetId: row.id,
        targetOrganizationId: row.organization_id,
        metadata: { entityType: 'client_work_task', name: row.title },
      });
      result.purged.push({ entityType: 'client_work_task', id: row.id, name: row.title, deleted: true });
    } catch (err) {
      console.error('Undo purge failed for task', row.id, err);
      result.errors.push({ entityType: 'client_work_task', id: row.id, error: err?.message || 'unknown' });
    }
  }

  const dueMilestones = await ClientProject.findMilestonesDueForPurge(now);
  for (const row of dueMilestones) {
    result.considered += 1;
    try {
      if (dryRun) {
        result.purged.push({ entityType: 'client_project_milestone', id: row.id, name: row.title, dryRun: true });
        continue;
      }
      await ClientProject.hardDeleteMilestone(row.id);
      await recordAuditEvent({
        action: AUDIT_ACTIONS.UNDO_PURGE_SWEEP,
        targetType: 'client_project_milestone',
        targetId: row.id,
        targetOrganizationId: row.organization_id,
        metadata: { entityType: 'client_project_milestone', name: row.title },
      });
      result.purged.push({ entityType: 'client_project_milestone', id: row.id, name: row.title, deleted: true });
    } catch (err) {
      console.error('Undo purge failed for milestone', row.id, err);
      result.errors.push({ entityType: 'client_project_milestone', id: row.id, error: err?.message || 'unknown' });
    }
  }

  const dueFiles = await ClientProject.findFilesDueForPurge(now);
  for (const row of dueFiles) {
    result.considered += 1;
    try {
      if (dryRun) {
        result.purged.push({ entityType: 'client_project_file', id: row.id, name: row.original_name, dryRun: true });
        continue;
      }
      await ClientProject.hardDeleteFileRecord(row.id);
      await unlinkQuiet(projectFilePath(row.filename));
      await recordAuditEvent({
        action: AUDIT_ACTIONS.UNDO_PURGE_SWEEP,
        targetType: 'client_project_file',
        targetId: row.id,
        targetOrganizationId: row.organization_id,
        metadata: { entityType: 'client_project_file', name: row.original_name },
      });
      result.purged.push({ entityType: 'client_project_file', id: row.id, name: row.original_name, deleted: true });
    } catch (err) {
      console.error('Undo purge failed for file', row.id, err);
      result.errors.push({ entityType: 'client_project_file', id: row.id, error: err?.message || 'unknown' });
    }
  }

  const dueContacts = await CrmContact.findContactsDueForPurge(now);
  for (const row of dueContacts) {
    result.considered += 1;
    const targetOrganizationId = row.client_organization_id || row.platform_org_id;
    try {
      if (dryRun) {
        result.purged.push({ entityType: 'crm_contact', id: row.contact_id, name: contactLabel(row), dryRun: true });
        continue;
      }
      await CrmContact.hardDeleteContact(row.contact_id);
      await recordAuditEvent({
        action: AUDIT_ACTIONS.UNDO_PURGE_SWEEP,
        targetType: 'crm_contact',
        targetId: String(row.contact_id),
        targetOrganizationId,
        metadata: { entityType: 'crm_contact', name: contactLabel(row) },
      });
      result.purged.push({ entityType: 'crm_contact', id: row.contact_id, name: contactLabel(row), deleted: true });
    } catch (err) {
      console.error('Undo purge failed for contact', row.contact_id, err);
      result.errors.push({ entityType: 'crm_contact', id: row.contact_id, error: err?.message || 'unknown' });
    }
  }

  result.completedAt = new Date().toISOString();
  return result;
}
