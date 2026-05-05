#!/usr/bin/env node
/**
 * Phase 2 reconciliation cron entrypoint when the scheduler runs
 * separately from the API (e.g. Render Cron). POSTs
 * /api/internal/reconciliation-run with RECONCILIATION_SECRET (or falls
 * back to PRIVACY_MAINTENANCE_SECRET so one secret can drive every
 * internal job if you prefer).
 *
 * Defaults to "previous completed month". Override with
 * RECONCILIATION_MONTH=YYYY-MM if you need to backfill.
 */
const url = String(process.env.RECONCILIATION_URL || '').trim();
const secret = String(
  process.env.RECONCILIATION_SECRET || process.env.PRIVACY_MAINTENANCE_SECRET || ''
).trim();
const monthOverride = String(process.env.RECONCILIATION_MONTH || '').trim();
const dryRun = String(process.env.RECONCILIATION_DRY_RUN || '').trim().toLowerCase() === 'true';

if (!url || !secret) {
  console.error(
    JSON.stringify({
      ok: false,
      error: 'missing_env',
      hint: 'Set RECONCILIATION_URL and RECONCILIATION_SECRET (or PRIVACY_MAINTENANCE_SECRET).',
    })
  );
  process.exit(1);
}

try {
  const target = new URL(url);
  if (monthOverride) target.searchParams.set('month', monthOverride);
  if (dryRun) target.searchParams.set('dryRun', 'true');
  const res = await fetch(target.toString(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  });
  const text = await res.text();
  console.log(text);
  if (!res.ok) {
    console.error(JSON.stringify({ ok: false, status: res.status }));
    process.exit(1);
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}
