import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.js';
import { registerPlatformMeRoutes } from './platform/meRoutes.js';
import { registerPlatformOrgRoutes } from './platform/orgRoutes.js';
import { registerPlatformStaffRoutes } from './platform/staffRoutes.js';
import platformTaskRoutes from './platform/taskRoutes.js';

const router = Router();

const platformLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(requireAuth, requirePlatformAdmin, platformLimiter);

registerPlatformMeRoutes(router);
registerPlatformOrgRoutes(router);
registerPlatformStaffRoutes(router);
router.use(platformTaskRoutes);

export default router;
