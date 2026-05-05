import { checkRetentionHeartbeat, runRetentionSweep } from './retentionPolicy.js';
import { runArchiveReviewReport } from './archiveReview.js';
import { runLicenseePurgeSweep } from './licenseePurge.js';

function shouldRunQuarterlyArchive(now = new Date()) {
  if (String(process.env.FORCE_ARCHIVE_REVIEW || '').trim().toLowerCase() === 'true') {
    return true;
  }
  const month = now.getUTCMonth(); // 0-based
  const day = now.getUTCDate();
  const quarterStartMonths = new Set([0, 3, 6, 9]); // Jan, Apr, Jul, Oct
  return day === 1 && quarterStartMonths.has(month);
}

/**
 * Same work as `privacyMaintenance.js` (retention sweep, heartbeat snapshot, quarterly archive review).
 * Run on whichever process has `STORAGE_PATH` pointing at the real export disk.
 */
export async function runPrivacyMaintenance({ dryRun = false, now = new Date() } = {}) {
  const maintenanceResult = {
    ok: true,
    startedAt: new Date().toISOString(),
  };

  const retention = await runRetentionSweep({ dryRun });
  const heartbeat = await checkRetentionHeartbeat();
  maintenanceResult.retention = retention;
  maintenanceResult.retentionHeartbeat = heartbeat;
  maintenanceResult.archiveReview = null;

  if (shouldRunQuarterlyArchive(now)) {
    maintenanceResult.archiveReview = await runArchiveReviewReport();
  }

  // DAT-03: piggy-back on the same nightly trigger and the same secret
  // as retention. Errors per-licensee are captured in the result; one
  // bad org won't fail the whole sweep.
  maintenanceResult.licenseePurge = await runLicenseePurgeSweep({ now, dryRun });

  return maintenanceResult;
}
