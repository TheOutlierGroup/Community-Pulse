import crypto from 'crypto';
import express from 'express';

import { runPrivacyMaintenance } from '../services/privacyMaintenanceRunner.js';

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

export default router;
