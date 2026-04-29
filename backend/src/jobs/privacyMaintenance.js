import { checkRetentionHeartbeat, runRetentionSweep } from '../services/retentionPolicy.js';
import { runArchiveReviewReport } from '../services/archiveReview.js';

function shouldRunQuarterlyArchive(now = new Date()) {
  if (String(process.env.FORCE_ARCHIVE_REVIEW || '').trim().toLowerCase() === 'true') {
    return true;
  }
  const month = now.getUTCMonth(); // 0-based
  const day = now.getUTCDate();
  const quarterStartMonths = new Set([0, 3, 6, 9]); // Jan, Apr, Jul, Oct
  return day === 1 && quarterStartMonths.has(month);
}

async function main() {
  const dryRun = String(process.env.RETENTION_DRY_RUN || '').trim().toLowerCase() === 'true';
  const maintenanceResult = {
    ok: true,
    startedAt: new Date().toISOString(),
  };

  const retention = await runRetentionSweep({ dryRun });
  const heartbeat = await checkRetentionHeartbeat();
  maintenanceResult.retention = retention;
  maintenanceResult.retentionHeartbeat = heartbeat;
  maintenanceResult.archiveReview = null;

  if (shouldRunQuarterlyArchive()) {
    maintenanceResult.archiveReview = await runArchiveReviewReport();
  }

  console.log(JSON.stringify(maintenanceResult, null, 2));
  if (!heartbeat.ok) {
    console.warn(
      JSON.stringify({ ok: false, type: 'retention_heartbeat_alert', heartbeat }, null, 2)
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
