import { checkRetentionHeartbeat, runRetentionSweep } from '../services/retentionPolicy.js';

async function main() {
  const dryRun = String(process.env.RETENTION_DRY_RUN || '').trim().toLowerCase() === 'true';
  const result = await runRetentionSweep({ dryRun });
  const heartbeat = await checkRetentionHeartbeat();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  if (!heartbeat.ok) {
    console.warn(JSON.stringify({ ok: false, type: 'retention_heartbeat_alert', heartbeat }, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
