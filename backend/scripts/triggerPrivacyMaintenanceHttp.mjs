#!/usr/bin/env node
/**
 * Cron entrypoint when the scheduler cannot mount the API's persistent disk (e.g. Render Cron).
 * Invokes POST /api/internal/privacy-maintenance with PRIVACY_MAINTENANCE_SECRET.
 */
const url = String(process.env.PRIVACY_MAINTENANCE_URL || '').trim();
const secret = String(process.env.PRIVACY_MAINTENANCE_SECRET || '').trim();

if (!url || !secret) {
  console.error(
    JSON.stringify({
      ok: false,
      error: 'missing_env',
      hint: 'Set PRIVACY_MAINTENANCE_URL and PRIVACY_MAINTENANCE_SECRET',
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
