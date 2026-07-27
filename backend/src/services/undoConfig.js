// Shared grace-period length for the undo feature's soft-delete tables
// (client_work_tasks, client_project_milestones, client_project_files,
// crm_contacts). Mirrors the shape of licence_config's offboard grace
// period (LicenseConfig.scheduleOffboard's graceDays), just fixed instead
// of caller-configurable since these are ordinary user deletes, not a
// staff-initiated offboard.
export const UNDO_RECOVERY_WINDOW_DAYS = 30;

export function undoPurgeAfter(now = new Date()) {
  return new Date(now.getTime() + UNDO_RECOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}
