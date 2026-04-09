import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.js';
import { registerPlatformMeRoutes } from './platform/meRoutes.js';
import { registerPlatformOrgRoutes } from './platform/orgRoutes.js';
import { registerPlatformStaffRoutes } from './platform/staffRoutes.js';
import platformTaskRoutes from './platform/taskRoutes.js';

const router = Router();
const APP_SURFACE = String(process.env.APP_SURFACE || 'all').toLowerCase();
const isPulseSurface = APP_SURFACE === 'pulse';
const platformRateLimitMax = Number.parseInt(process.env.PLATFORM_RATE_LIMIT_MAX || '300', 10);

const platformLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number.isFinite(platformRateLimitMax) && platformRateLimitMax > 0 ? platformRateLimitMax : 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = req.user?.id;
    if (userId) return `user:${userId}`;
    return req.ip || 'unknown';
  },
});

router.use(requireAuth, requirePlatformAdmin, platformLimiter);

if (isPulseSurface) {
  router.use((req, res, next) => {
    const path = req.path;
    const allowed =
      /^\/me(\/notifications)?$/.test(path)
      || /^\/organizations\/[^/]+$/.test(path)
      || /^\/organizations\/[^/]+\/logo$/.test(path)
      || /^\/organizations\/[^/]+\/pulse-dashboard$/.test(path)
      || /^\/organizations\/[^/]+\/pulse-link-invites(?:\/.*)?$/.test(path);

    if (!allowed) return res.status(404).json({ error: 'Not found' });
    return next();
  });
}

registerPlatformMeRoutes(router);
registerPlatformOrgRoutes(router);
registerPlatformStaffRoutes(router);
router.use(platformTaskRoutes);

export default router;
