import crypto from 'crypto';
import express from 'express';

import { runPrivacyMaintenance } from '../services/privacyMaintenanceRunner.js';
import { runLicenseExpirySweep } from '../services/licenseExpirySweep.js';
import {
  buildMonthlyReconciliation,
  listLicenseesForReconciliation,
  previousCompletedMonthIso,
} from '../services/assessmentReconciliation.js';
import { sendAssessmentReconciliationEmail } from '../services/email.js';
import * as User from '../models/User.js';

const router = express.Router();

function bearerMatches(expectedSecret, authorizationHeader) {
  const m = /^Bearer\s+([\s\S]+)$/i.exec(authorizationHeader || '');
  const presented = m ? String(m[1]).trim() : '';
  try {
    const a = Buffer.from(presented, 'utf8');
    const b = Buffer.from(expectedSecret, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Cron-friendly trigger: POST with Bearer PRIVACY_MAINTENANCE_SECRET.
 * Intended for hosts that cannot mount the same disk as the API (e.g. Render Cron).
 */
router.post('/privacy-maintenance', async (req, res) => {
  const secret = String(process.env.PRIVACY_MAINTENANCE_SECRET || '').trim();
  if (secret.length < 24) {
    return res.status(503).json({ error: 'Maintenance endpoint is not configured' });
  }
  if (!bearerMatches(secret, req.get('authorization'))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dryRun = String(req.query.dryRun || '').trim().toLowerCase() === 'true';
  try {
    const result = await runPrivacyMaintenance({ dryRun });
    res.json(result);
  } catch (error) {
    console.error('Privacy maintenance HTTP run failed:', error);
    res.status(500).json({
      error: 'Maintenance failed',
      message: error?.message || 'unknown_error',
    });
  }
});

/**
 * INF-11 cron entrypoint. Same Bearer-secret pattern as
 * /privacy-maintenance — intended for Render Cron / external schedulers.
 * Safe to call as often as the scheduler likes; the ledger is the
 * idempotency boundary.
 */
/**
 * Phase 2 reconciliation cron entrypoint. Builds the previous month's
 * CSV per licensee and emails it to the platform admins of that
 * licensee. Idempotent because the underlying ledger is append-only —
 * running twice in the same month just re-sends the same numbers.
 */
router.post('/reconciliation-run', async (req, res) => {
  const secret = String(
    process.env.RECONCILIATION_SECRET || process.env.PRIVACY_MAINTENANCE_SECRET || ''
  ).trim();
  if (secret.length < 24) {
    return res.status(503).json({ error: 'Reconciliation endpoint is not configured' });
  }
  if (!bearerMatches(secret, req.get('authorization'))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const monthIso = String(req.query?.month || '').trim() || previousCompletedMonthIso();
  const dryRun = String(req.query?.dryRun || '').trim().toLowerCase() === 'true';

  try {
    const licensees = await listLicenseesForReconciliation();
    const results = [];
    for (const licensee of licensees) {
      try {
        const report = await buildMonthlyReconciliation(licensee.id, monthIso);
        let recipients = [];
        if (!dryRun) {
          const admins = await User.listUsersForOrg(licensee.id, { role: 'admin' });
          recipients = admins
            .filter((u) => u.login_enabled !== false && !u.deactivated_at && u.email)
            .map((u) => String(u.email).trim().toLowerCase());
          if (recipients.length > 0) {
            await sendAssessmentReconciliationEmail({
              to: recipients,
              organizationName: licensee.name,
              monthIso,
              summary: report.summary,
              csvFilename: report.filename,
              csv: report.csv,
            });
          }
        }
        results.push({
          licenseeOrganizationId: licensee.id,
          name: licensee.name,
          summary: report.summary,
          recipientsCount: recipients.length,
        });
      } catch (perLicenseeError) {
        console.error('Reconciliation failed for licensee', licensee.id, perLicenseeError);
        results.push({
          licenseeOrganizationId: licensee.id,
          name: licensee.name,
          error: perLicenseeError?.message || 'unknown_error',
        });
      }
    }
    res.json({ ok: true, monthIso, dryRun, results });
  } catch (error) {
    console.error('Reconciliation run failed:', error);
    res.status(500).json({ error: 'Reconciliation failed', message: error?.message || 'unknown_error' });
  }
});

router.post('/licence-expiry-sweep', async (req, res) => {
  const secret = String(process.env.LICENCE_EXPIRY_SWEEP_SECRET || process.env.PRIVACY_MAINTENANCE_SECRET || '').trim();
  if (secret.length < 24) {
    return res.status(503).json({ error: 'Licence expiry sweep is not configured' });
  }
  if (!bearerMatches(secret, req.get('authorization'))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dryRun = String(req.query.dryRun || '').trim().toLowerCase() === 'true';
  try {
    const result = await runLicenseExpirySweep({ dryRun });
    res.json(result);
  } catch (error) {
    console.error('Licence expiry sweep failed:', error);
    res.status(500).json({
      error: 'Sweep failed',
      message: error?.message || 'unknown_error',
    });
  }
});

export default router;
