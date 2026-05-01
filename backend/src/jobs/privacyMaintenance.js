import { runPrivacyMaintenance } from '../services/privacyMaintenanceRunner.js';

async function runViaHttp() {
  const url = String(process.env.PRIVACY_MAINTENANCE_URL || '').trim();
  const secret = String(process.env.PRIVACY_MAINTENANCE_SECRET || '').trim();
  if (!url) return null;
  if (!secret) {
    throw new Error('PRIVACY_MAINTENANCE_SECRET must be set when PRIVACY_MAINTENANCE_URL is configured');
  }

  const dryRun = String(process.env.RETENTION_DRY_RUN || '').trim().toLowerCase() === 'true';
  const endpoint = dryRun ? `${url}${url.includes('?') ? '&' : '?'}dryRun=true` : url;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Privacy maintenance HTTP call failed (${response.status}): ${bodyText}`);
  }
  try {
    return JSON.parse(bodyText);
  } catch {
    return { ok: true, raw: bodyText };
  }
}

async function main() {
  const maintenanceResult =
    (await runViaHttp()) ??
    (await runPrivacyMaintenance({
      dryRun: String(process.env.RETENTION_DRY_RUN || '').trim().toLowerCase() === 'true',
    }));

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
