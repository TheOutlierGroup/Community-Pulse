import { query } from '../config/database.js';
import * as User from '../models/User.js';
import * as LicenseExpiryNotification from '../models/LicenseExpiryNotification.js';
import { isResendConfigured, sendLicenseExpiryWarningEmail } from './email.js';

/**
 * Days-before-expiry where we want to nudge licensee admins. Override via
 * `LICENCE_EXPIRY_THRESHOLDS` env var (comma-separated integers). The
 * `0` threshold means "the day the licence has just expired" so admins
 * still get a heads-up after suspension.
 */
export function getDefaultThresholdDays() {
  const raw = String(process.env.LICENCE_EXPIRY_THRESHOLDS || '').trim();
  if (raw) {
    const parsed = raw
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((n) => Number.isInteger(n) && n >= 0);
    if (parsed.length > 0) return Array.from(new Set(parsed)).sort((a, b) => b - a);
  }
  return [30, 14, 7, 1, 0];
}

/**
 * Day-bucket distance between `now` and `contractEnd`, rounded UP so a
 * licence ending in 13.4 days still triggers the 14-day threshold and
 * not the 7-day one. A contract that already ended returns 0 (the
 * "post-expiry" bucket) until we're more than `EXPIRED_GRACE_DAYS` past it.
 */
const EXPIRED_GRACE_DAYS = 30;

export function bucketDaysUntil(contractEnd, now = new Date()) {
  if (!contractEnd) return null;
  const endMs = new Date(contractEnd).getTime();
  if (Number.isNaN(endMs)) return null;
  const diffMs = endMs - now.getTime();
  if (diffMs <= 0) {
    const daysSince = Math.floor(-diffMs / (24 * 60 * 60 * 1000));
    return daysSince > EXPIRED_GRACE_DAYS ? null : 0;
  }
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

function pickThresholdForDays(days, thresholds) {
  if (days === null || days === undefined) return null;
  // Find the smallest threshold >= days. If days = 13 and thresholds = [30, 14, 7, 1, 0],
  // 14 wins. If days = 0 (just expired), 0 wins.
  let candidate = null;
  for (const t of thresholds) {
    if (t >= days && (candidate === null || t < candidate)) candidate = t;
  }
  return candidate;
}

function buildManageLicenceUrl(organizationId) {
  const base = String(process.env.APP_URL || process.env.FRONTEND_ORIGIN || '').split(',')[0].trim();
  if (!base) return '';
  return `${base.replace(/\/$/, '')}/platform/clients/${encodeURIComponent(organizationId)}/account`;
}

async function listActiveLicensees() {
  const { rows } = await query(
    `SELECT o.id, o.name, lc.contract_end, lc.status, lc.email_template_overrides
     FROM organizations o
     INNER JOIN licence_config lc ON lc.organization_id = o.id
     WHERE o.kind = 'licensee'
       AND lc.contract_end IS NOT NULL`
  );
  return rows;
}

async function findAdminRecipients(organizationId) {
  const admins = await User.listUsersForOrg(organizationId, { role: 'admin' });
  return admins
    .filter((u) => u.login_enabled !== false && !u.deactivated_at)
    // COM-03: skip users who have explicitly opted out of expiry
    // warnings. Defaults remain opt-in.
    .filter((u) => !(u.notification_preferences && u.notification_preferences.expiryWarningOptOut === true))
    .map((u) => ({
      id: u.id,
      email: String(u.email || '').trim().toLowerCase(),
      name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email,
    }))
    .filter((r) => r.email);
}

/**
 * Run a single expiry-warning sweep. Idempotent: a notification at a
 * given (organization, contract_end, threshold) is recorded in the ledger
 * via a unique constraint, so re-running the sweep on the same day won't
 * spam admins. `dryRun: true` skips both email send and ledger insert
 * but still reports who would have been notified.
 */
export async function runLicenseExpirySweep({ now = new Date(), dryRun = false, thresholds = null } = {}) {
  const effectiveThresholds = Array.isArray(thresholds) && thresholds.length > 0
    ? Array.from(new Set(thresholds.filter((n) => Number.isInteger(n) && n >= 0))).sort((a, b) => b - a)
    : getDefaultThresholdDays();

  const result = {
    ok: true,
    startedAt: new Date().toISOString(),
    dryRun,
    thresholdsConsidered: effectiveThresholds,
    licenseesEvaluated: 0,
    notificationsSent: 0,
    notificationsSkipped: 0,
    errors: [],
    notified: [],
  };

  const licensees = await listActiveLicensees();
  result.licenseesEvaluated = licensees.length;

  for (const licensee of licensees) {
    const days = bucketDaysUntil(licensee.contract_end, now);
    if (days === null) continue;
    const threshold = pickThresholdForDays(days, effectiveThresholds);
    if (threshold === null) continue;

    const recipients = await findAdminRecipients(licensee.id);
    if (recipients.length === 0) {
      result.notificationsSkipped += 1;
      continue;
    }

    if (dryRun) {
      result.notificationsSent += 1;
      result.notified.push({
        organizationId: licensee.id,
        organizationName: licensee.name,
        thresholdDays: threshold,
        daysRemaining: days,
        recipients: recipients.map((r) => r.email),
      });
      continue;
    }

    // Atomically claim this notification slot before sending so concurrent
    // sweeps can't both fire emails for the same threshold.
    const claimed = await LicenseExpiryNotification.tryClaimNotification({
      organizationId: licensee.id,
      contractEnd: licensee.contract_end,
      thresholdDays: threshold,
      recipientsCount: recipients.length,
      metadata: { daysRemainingAtSend: days, status: licensee.status },
    });
    if (!claimed) {
      result.notificationsSkipped += 1;
      continue;
    }

    if (!isResendConfigured()) {
      result.errors.push({
        organizationId: licensee.id,
        thresholdDays: threshold,
        error: 'resend_not_configured',
      });
      continue;
    }

    const manageLicenceUrl = buildManageLicenceUrl(licensee.id);
    // COM-01: pull the per-licensee email overrides if any. The licence
    // row already has them via the SELECT in listActiveLicensees, but
    // we re-narrow to the expiryWarning slot defensively in case the
    // data shape ever drifts.
    const overrides = (licensee.email_template_overrides && licensee.email_template_overrides.expiryWarning) || {};
    let sendErrors = 0;
    for (const recipient of recipients) {
      try {
        await sendLicenseExpiryWarningEmail({
          to: recipient.email,
          recipientName: recipient.name,
          organizationName: licensee.name,
          contractEndIso: licensee.contract_end,
          daysRemaining: days,
          manageLicenceUrl,
          overrides,
        });
      } catch (error) {
        sendErrors += 1;
        result.errors.push({
          organizationId: licensee.id,
          recipient: recipient.email,
          thresholdDays: threshold,
          error: error?.message || 'send_failed',
        });
      }
    }

    result.notificationsSent += 1;
    result.notified.push({
      organizationId: licensee.id,
      organizationName: licensee.name,
      thresholdDays: threshold,
      daysRemaining: days,
      recipients: recipients.map((r) => r.email),
      sendErrors,
    });
  }

  return result;
}
