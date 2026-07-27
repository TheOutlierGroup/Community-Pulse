import fs from 'fs';
import path from 'path';
import { query } from '../config/database.js';
import { ensureStorageDirs } from '../config/storage.js';
import { logAuditEvent } from './auditLog.js';
import { sendRetentionAlertEmail } from './email.js';

function parseDays(raw, fallbackDays) {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(value) || value <= 0) return fallbackDays;
  return value;
}

function isStorageAccessError(error) {
  return ['EACCES', 'EPERM', 'EROFS'].includes(error?.code);
}

export function getRetentionPolicy() {
  return {
    exportRetentionDays: parseDays(process.env.EXPORT_RETENTION_DAYS, 30),
    tokenRetentionDays: parseDays(process.env.TOKEN_RETENTION_DAYS, 30),
    projectCloseRetentionDays: parseDays(process.env.RETENTION_PROJECT_CLOSE_DAYS, 90),
  };
}

export async function sweepExpiredExports({ now = Date.now() } = {}) {
  const { exportRetentionDays } = getRetentionPolicy();
  let exportsDir;
  try {
    ({ exportsDir } = ensureStorageDirs());
  } catch (error) {
    if (isStorageAccessError(error)) {
      return { deleted: 0, skipped: true, reason: 'storage_unwritable' };
    }
    throw error;
  }
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

// Returns the affected row count. Used for both DELETE and the
// PT-02 token-revocation UPDATE, hence the neutral name.
async function runStatement(sql, params) {
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
  const [passwordResetDeleted, pulseHandoffDeleted, pulseLinkTokensRevoked] = await Promise.all([
    runStatement(`DELETE FROM password_reset_tokens WHERE expires_at < $1::timestamptz`, [cutoffIso]),
    runStatement(`DELETE FROM pulse_handoff_tokens WHERE expires_at < $1::timestamptz`, [cutoffIso]),
    // PT-02: clear the token rather than delete the row.
    // pulse_link_responses.invite_id is ON DELETE CASCADE (migration 014),
    // so deleting a spent invite would take that respondent's survey
    // answers with it. Nulling token_hash retires the credential while
    // the invite record and its responses stay intact for reporting.
    // findByTokenHash already refuses anything past expires_at; this is
    // the cleanup that stops dead hashes accumulating indefinitely.
    runStatement(
      `UPDATE pulse_link_invites
       SET token_hash = NULL, updated_at = NOW()
       WHERE token_hash IS NOT NULL
         AND expires_at IS NOT NULL
         AND expires_at < $1::timestamptz`,
      [cutoffIso]
    ),
  ]);
  return { passwordResetDeleted, pulseHandoffDeleted, pulseLinkTokensRevoked };
}

export function getRetentionFieldPolicy() {
  return {
    identifiers: {
      pulse_link_invites: ['email', 'display_name'],
    },
    retainedAnalyticsFields: {
      pulse_link_responses: ['stage', 'step1_data', 'step2_data', 'step3_data', 'step4_data', 'contribution_style'],
    },
  };
}

export async function startRetentionJobRun(jobName, details = {}) {
  const { rows } = await query(
    `INSERT INTO retention_job_runs (job_name, status, details)
     VALUES ($1, 'running', $2::jsonb)
     RETURNING *`,
    [jobName, JSON.stringify(details)]
  );
  return rows[0];
}

export async function finishRetentionJobRun(runId, status, details) {
  const safeStatus = status === 'failed' ? 'failed' : 'ok';
  const { rows } = await query(
    `UPDATE retention_job_runs
     SET status = $2,
         finished_at = NOW(),
         records_scanned = COALESCE(($3::jsonb ->> 'recordsScanned')::int, records_scanned),
         records_anonymized = COALESCE(($3::jsonb ->> 'recordsAnonymized')::int, records_anonymized),
         error_code = $4,
         error_message = $5,
         details = COALESCE(details, '{}'::jsonb) || $3::jsonb
     WHERE id = $1
     RETURNING *`,
    [runId, safeStatus, JSON.stringify(details || {}), details?.errorCode || null, details?.errorMessage || null]
  );
  return rows[0] || null;
}

async function sendRetentionAlert(payload) {
  const emailRecipients = String(process.env.RETENTION_ALERT_EMAIL || '').trim();
  if (emailRecipients) {
    const emailSent = await sendRetentionAlertEmail({
      subject: `Retention alert: ${payload?.kind || 'job failure'}`,
      bodyText: `Retention job "${payload?.jobName || 'retention_sweep'}" reported an issue.\n\nError: ${
        payload?.error || 'unknown'
      }\nRun ID: ${payload?.runId || 'n/a'}`,
      payload,
    });
    if (emailSent) return true;
  }

  const webhook = String(process.env.RETENTION_ALERT_WEBHOOK || '').trim();
  if (!webhook) return false;
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function anonymizeClosedProjectIdentifiers({ now = Date.now(), dryRun = false } = {}) {
  const { projectCloseRetentionDays } = getRetentionPolicy();
  const cutoffIso = new Date(now - projectCloseRetentionDays * 24 * 60 * 60 * 1000).toISOString();
  const { rows: eligibleRows } = await query(
    `SELECT DISTINCT pli.id AS invite_id, pli.organization_id
     FROM pulse_link_invites pli
     JOIN pulse_link_responses plr ON plr.invite_id = pli.id
     JOIN pulse_sessions ps ON ps.id = plr.session_id
     WHERE ps.closed_at IS NOT NULL
       AND ps.closed_at <= $1::timestamptz
       AND (pli.email IS NOT NULL OR pli.display_name IS NOT NULL)`,
    [cutoffIso]
  );
  const inviteIds = eligibleRows.map((row) => row.invite_id);
  const orgIds = Array.from(new Set(eligibleRows.map((row) => row.organization_id).filter(Boolean)));

  let anonymized = 0;
  if (!dryRun && inviteIds.length > 0) {
    const { rowCount } = await query(
      `UPDATE pulse_link_invites
       SET email = CONCAT('anonymized+', id::text, '@redacted.local'),
           display_name = 'Anonymized Participant',
           updated_at = NOW()
       WHERE id = ANY($1::uuid[])`,
      [inviteIds]
    );
    anonymized = rowCount || 0;
  }

  for (const orgId of orgIds) {
    await logAuditEvent({
      action: 'retention.anonymize_identifiers',
      targetType: 'organization',
      targetId: orgId,
      targetOrganizationId: orgId,
      result: dryRun ? 'dry_run' : 'ok',
      metadata: {
        cutoffIso,
        inviteCount: inviteIds.length,
        fieldPolicy: getRetentionFieldPolicy(),
      },
    });
  }

  return {
    cutoffIso,
    recordsScanned: inviteIds.length,
    recordsAnonymized: dryRun ? 0 : anonymized,
    dryRun,
  };
}

export async function archiveInactiveClientOrganizations({ now = Date.now(), dryRun = false } = {}) {
  const cutoffIso = new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString();
  const { rows } = await query(
    `SELECT id
     FROM organizations
     WHERE kind = 'client'
       AND archived_at IS NULL
       AND COALESCE(last_activity_at, created_at) <= $1::timestamptz`,
    [cutoffIso]
  );
  const orgIds = rows.map((row) => row.id);
  let archived = 0;
  if (!dryRun && orgIds.length > 0) {
    const { rowCount } = await query(
      `UPDATE organizations
       SET archived_at = NOW(),
           tier3_archive_at = COALESCE(tier3_archive_at, NOW()),
           tier3_disposal_due_at = COALESCE(tier3_disposal_due_at, NOW() + INTERVAL '7 years')
       WHERE id = ANY($1::uuid[])`,
      [orgIds]
    );
    archived = rowCount || 0;
  }
  return {
    cutoffIso,
    recordsScanned: orgIds.length,
    recordsArchived: dryRun ? 0 : archived,
    dryRun,
  };
}

export async function checkRetentionHeartbeat({
  jobName = 'retention_sweep',
  maxAgeHours = 25,
  now = Date.now(),
} = {}) {
  const maxAgeMs = (Number.isFinite(maxAgeHours) && maxAgeHours > 0 ? maxAgeHours : 25) * 60 * 60 * 1000;
  const { rows } = await query(
    `SELECT *
     FROM retention_job_runs
     WHERE job_name = $1
     ORDER BY started_at DESC
     LIMIT 1`,
    [jobName]
  );
  const latest = rows[0] || null;
  if (!latest) return { ok: false, reason: 'missing_run', latest: null };
  const startedAt = new Date(latest.started_at).getTime();
  const tooOld = !Number.isFinite(startedAt) || now - startedAt > maxAgeMs;
  const statusBad = latest.status !== 'ok';
  return {
    ok: !(tooOld || statusBad),
    reason: tooOld ? 'missed_window' : statusBad ? 'last_run_failed' : 'ok',
    latest,
  };
}

export async function runRetentionSweep({ now = Date.now(), dryRun = false } = {}) {
  const run = await startRetentionJobRun('retention_sweep', { dryRun });
  try {
    const [exportsResult, tokensResult, anonymizeResult, archiveResult] = await Promise.all([
      sweepExpiredExports({ now }),
      sweepExpiredTokens({ now }),
      anonymizeClosedProjectIdentifiers({ now, dryRun }),
      archiveInactiveClientOrganizations({ now, dryRun }),
    ]);
    const summary = {
      policy: getRetentionPolicy(),
      fields: getRetentionFieldPolicy(),
      exports: exportsResult,
      tokens: tokensResult,
      anonymize: anonymizeResult,
      archive: archiveResult,
      heartbeat: {
        runId: run.id,
        startedAt: run.started_at,
      },
    };
    await finishRetentionJobRun(run.id, 'ok', {
      recordsScanned: anonymizeResult.recordsScanned,
      recordsAnonymized: anonymizeResult.recordsAnonymized,
      recordsArchived: archiveResult.recordsArchived,
      dryRun,
    });
    return summary;
  } catch (error) {
    await finishRetentionJobRun(run.id, 'failed', {
      errorCode: error?.code || 'retention_error',
      errorMessage: error?.message || 'Retention sweep failed',
      dryRun,
    });
    await sendRetentionAlert({
      kind: 'retention_failure',
      jobName: 'retention_sweep',
      runId: run.id,
      error: error?.message || 'unknown_error',
    });
    throw error;
  }
}
