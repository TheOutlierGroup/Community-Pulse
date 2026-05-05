#!/usr/bin/env node
/**
 * INF-11 cron entrypoint when the scheduler runs separately from the API
 * (e.g. Render Cron). Hits POST /api/internal/licence-expiry-sweep with
 * LICENCE_EXPIRY_SWEEP_SECRET (or PRIVACY_MAINTENANCE_SECRET as a
 * fallback so the same secret can power both jobs).
 */
const url = String(process.env.LICENCE_EXPIRY_SWEEP_URL || '').trim();
const secret = String(
  process.env.LICENCE_EXPIRY_SWEEP_SECRET || process.env.PRIVACY_MAINTENANCE_SECRET || ''
).trim();

if (!url || !secret) {
  console.error(
    JSON.stringify({
      ok: false,
      error: 'missing_env',
      hint: 'Set LICENCE_EXPIRY_SWEEP_URL and LICENCE_EXPIRY_SWEEP_SECRET (or PRIVACY_MAINTENANCE_SECRET).',
    })
  );
  process.exit(1);
}

try {
  const res = await fetch(url, {
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
