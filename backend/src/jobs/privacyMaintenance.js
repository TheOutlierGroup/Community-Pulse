import { runPrivacyMaintenance } from '../services/privacyMaintenanceRunner.js';

async function main() {
  const dryRun = String(process.env.RETENTION_DRY_RUN || '').trim().toLowerCase() === 'true';
  const maintenanceResult = await runPrivacyMaintenance({ dryRun });

  console.log(JSON.stringify(maintenanceResult, null, 2));
  const { retentionHeartbeat: heartbeat } = maintenanceResult;
  if (!heartbeat?.ok) {
    console.warn(
      JSON.stringify({ ok: false, type: 'retention_heartbeat_alert', heartbeat }, null, 2)
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
