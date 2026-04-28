import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requirePlatformUser } from '../middleware/auth.js';
import { registerPlatformMeRoutes } from './platform/meRoutes.js';
import { registerPlatformOrgRoutes } from './platform/orgRoutes.js';
import { registerPlatformStaffRoutes } from './platform/staffRoutes.js';
import platformComplianceRoutes from './platform/complianceRoutes.js';
import platformTaskRoutes from './platform/taskRoutes.js';
import platformPrivacyRoutes from './platform/privacyRoutes.js';
import { checkPulseSoWhatSummaryHealth } from '../services/pulseSoWhatSummary.js';

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

router.use(requireAuth, requirePlatformUser, platformLimiter);
router.use((req, _res, next) => {
  if (req.url.includes('rhythm-engine')) {
    req.url = req.url
      .replaceAll('rhythm-engine-link-invites', 'pulse-link-invites')
      .replaceAll('rhythm-engine-timepoints', 'pulse-timepoints')
      .replaceAll('rhythm-engine-sessions', 'pulse-sessions')
      .replaceAll('rhythm-engine-dashboard', 'pulse-dashboard')
      .replaceAll('rhythm-engine-handoff-link', 'pulse-handoff-link');
  }
  next();
});

if (isPulseSurface) {
  router.use((req, res, next) => {
    const path = req.path;
    const allowed =
      /^\/me(\/notifications)?$/.test(path)
      || /^\/organizations\/[^/]+$/.test(path)
      || /^\/organizations\/[^/]+\/logo$/.test(path)
      || /^\/organizations\/[^/]+\/pulse-dashboard$/.test(path)
      || /^\/organizations\/[^/]+\/pulse-link-invites(?:\/.*)?$/.test(path)
      || /^\/health\/ai-summary$/.test(path);

    if (!allowed) return res.status(404).json({ error: 'Not found' });
    return next();
  });
}

registerPlatformMeRoutes(router);
registerPlatformOrgRoutes(router);
registerPlatformStaffRoutes(router);
router.get('/health/ai-summary', async (req, res) => {
  const live = String(req.query?.live || '').trim().toLowerCase() !== 'false';
  const health = await checkPulseSoWhatSummaryHealth({ live });
  return res.status(health.ok ? 200 : 503).json(health);
});
router.use(platformComplianceRoutes);
router.use(platformPrivacyRoutes);
router.use(platformTaskRoutes);

export default router;
