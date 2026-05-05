import rateLimit from 'express-rate-limit';

/**
 * SEC-02 sensitive-action rate limiter factory. Use this for individual
 * routes where the global platformLimiter (300/15min/user) is too lax —
 * password resets, invite blasts, brand asset uploads, data export,
 * off-board, and the manual licence sweep.
 *
 * Limits are intentionally generous-but-finite: enough that legitimate
 * admin work isn't impeded, tight enough that a stolen token can't be
 * used to spam invites or scrape exports.
 *
 * Keying:
 *   - if there's a logged-in user, key by user id (an admin spamming on
 *     two devices still hits the limit collectively)
 *   - else fall back to IP (auth flows pre-login)
 */
export function sensitiveLimiter({ name, windowMs = 60 * 60 * 1000, max = 30 } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const userId = req.user?.id;
      if (userId) return `${name}:user:${userId}`;
      return `${name}:ip:${req.ip || 'unknown'}`;
    },
    message: { error: 'Too many requests. Please slow down and try again later.' },
  });
}

// Pre-built limiters with sensible defaults. Imported by route files.
export const inviteSendLimiter = sensitiveLimiter({ name: 'invite_send', windowMs: 60 * 60 * 1000, max: 60 });
export const passwordResetByAdminLimiter = sensitiveLimiter({ name: 'pw_reset_admin', windowMs: 60 * 60 * 1000, max: 30 });
export const brandUploadLimiter = sensitiveLimiter({ name: 'brand_upload', windowMs: 60 * 60 * 1000, max: 30 });
export const dataExportLimiter = sensitiveLimiter({ name: 'data_export', windowMs: 60 * 60 * 1000, max: 12 });
export const offboardLimiter = sensitiveLimiter({ name: 'offboard', windowMs: 60 * 60 * 1000, max: 12 });
export const expirySweepManualLimiter = sensitiveLimiter({ name: 'expiry_sweep', windowMs: 60 * 60 * 1000, max: 12 });
export const supportTaskLimiter = sensitiveLimiter({ name: 'support_task', windowMs: 60 * 60 * 1000, max: 30 });
