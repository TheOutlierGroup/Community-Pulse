import fs from 'fs';
import path from 'path';
import { query } from '../config/database.js';
import { ensureStorageDirs } from '../config/storage.js';

function parseDays(raw, fallbackDays) {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(value) || value <= 0) return fallbackDays;
  return value;
}

export function getRetentionPolicy() {
  return {
    exportRetentionDays: parseDays(process.env.EXPORT_RETENTION_DAYS, 30),
    tokenRetentionDays: parseDays(process.env.TOKEN_RETENTION_DAYS, 30),
  };
}

export async function sweepExpiredExports({ now = Date.now() } = {}) {
  const { exportRetentionDays } = getRetentionPolicy();
  const { exportsDir } = ensureStorageDirs();
  const cutoffMs = now - exportRetentionDays * 24 * 60 * 60 * 1000;
  const entries = await fs.promises.readdir(exportsDir, { withFileTypes: true });
  let deleted = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(exportsDir, entry.name);
    const stat = await fs.promises.stat(fullPath);
    if (stat.mtimeMs >= cutoffMs) continue;
    await fs.promises.unlink(fullPath);
    deleted += 1;
  }
  return { deleted };
}

async function runDelete(sql, params) {
  try {
    const { rowCount } = await query(sql, params);
    return rowCount || 0;
  } catch (error) {
    if (error?.code === '42P01') return 0; // undefined_table in older databases
    throw error;
  }
}

export async function sweepExpiredTokens({ now = Date.now() } = {}) {
  const { tokenRetentionDays } = getRetentionPolicy();
  const cutoffIso = new Date(now - tokenRetentionDays * 24 * 60 * 60 * 1000).toISOString();
  const [passwordResetDeleted, pulseHandoffDeleted] = await Promise.all([
    runDelete(`DELETE FROM password_reset_tokens WHERE expires_at < $1::timestamptz`, [cutoffIso]),
    runDelete(`DELETE FROM pulse_handoff_tokens WHERE expires_at < $1::timestamptz`, [cutoffIso]),
  ]);
  return { passwordResetDeleted, pulseHandoffDeleted };
}

export async function runRetentionSweep({ now = Date.now() } = {}) {
  const [exportsResult, tokensResult] = await Promise.all([
    sweepExpiredExports({ now }),
    sweepExpiredTokens({ now }),
  ]);
  return {
    policy: getRetentionPolicy(),
    exports: exportsResult,
    tokens: tokensResult,
  };
}
