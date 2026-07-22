import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, blockSupportWrites, requireEnterpriseClientSelf } from '../middleware/auth.js';
import { registerPlatformOrgRoutes } from './platform/orgRoutes.js';
import { registerPlatformStaffRoutes } from './platform/staffRoutes.js';
import platformTaskRoutes from './platform/taskRoutes.js';

// Mounted at '/api/platform', BEFORE the main platformRouter (see
// server.js). Gives an Enterprise-tier client org's own admin/employee
// users self-service access to a small allowlisted slice of the
// otherwise staff-only /platform/organizations/:id/* surface — Dashboard,
// Users, Tasks, and the Rhythm Engine dashboard — for their own org only.
//
// Why a separate router instead of widening the main one: the main
// platformRouter gates everything behind requireWorkspaceUser (platform or
// licensee org kind only), and a lot of downstream handlers (e.g.
// requirePlatformAdminRole, which only checks role === 'admin') implicitly
// trust that gate to have already excluded client orgs. Widening that gate
// would let a client-org "admin" reach things like org delete/offboard or
// licence-config edits — real privilege escalation. Instead, this router
// reuses the exact same existing route handlers (imported straight from
// orgRoutes.js/taskRoutes.js/staffRoutes.js, unmodified) but restricts
// which paths can ever reach them via an explicit allowlist checked before
// any route dispatch, plus a route-param check that the requested org is
// always the caller's own. Every path *not* on the allowlist 404s here —
// it never reaches the (potentially dangerous) handlers registered below.
const router = Router();

const enterpriseSelfLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number.parseInt(process.env.PLATFORM_RATE_LIMIT_MAX || '300', 10) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : req.ip || 'unknown'),
});

router.use(requireAuth, blockSupportWrites, requireEnterpriseClientSelf, enterpriseSelfLimiter);

// Mirrors the same rhythm-engine-* -> pulse-* rewrite platformRouter.js
// applies, so frontend calls to .../rhythm-engine-dashboard etc. resolve
// against the same underlying orgRoutes.js pulse-* handlers.
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

// Every method+path an Enterprise self-service caller may ever reach.
// Anything else 404s before route dispatch, regardless of what's
// registered below. Method-aware on purpose: several paths here have a
// far more dangerous sibling verb at the EXACT same path registered in
// orgRoutes.js — most importantly bare /organizations/:id, where GET is
// the harmless org-overview read this router exists to allow, but PATCH
// edits arbitrary org settings (including clientPortalTier itself — a
// self-escalation path) and DELETE deletes the organization outright. A
// path-only allowlist would have let both of those through unnoticed.
const ANY = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
const ALLOWED_ROUTES = [
  { methods: ['GET'], pattern: /^\/organizations\/[^/]+$/ }, // org overview — NOT PATCH/DELETE, see above
  { methods: ['GET', 'POST', 'DELETE'], pattern: /^\/organizations\/[^/]+\/logo$/ },
  { methods: ['GET'], pattern: /^\/organizations\/[^/]+\/dashboard$/ },
  { methods: ['GET'], pattern: /^\/organizations\/[^/]+\/users$/ },
  { methods: ['PATCH'], pattern: /^\/organizations\/[^/]+\/users\/[^/]+$/ },
  { methods: ['GET', 'POST', 'DELETE'], pattern: /^\/organizations\/[^/]+\/users\/[^/]+\/avatar$/ },
  { methods: ['POST'], pattern: /^\/organizations\/[^/]+\/invites$/ }, // invitedRole forced to admin server-side
  // Full task board: CRUD, checklist, comments, images, watch, reorder,
  // label-suggestions, assignable-users — no dangerous same-path sibling.
  { methods: ANY, pattern: /^\/organizations\/[^/]+\/tasks(\/.*)?$/ },
  { methods: ['GET'], pattern: /^\/organizations\/[^/]+\/pulse-dashboard$/ },
  { methods: ANY, pattern: /^\/organizations\/[^/]+\/pulse-sessions(\/.*)?$/ },
  { methods: ANY, pattern: /^\/organizations\/[^/]+\/pulse-timepoints(\/.*)?$/ },
  { methods: ['POST'], pattern: /^\/organizations\/[^/]+\/pulse-trend-signals$/ },
  { methods: ['POST'], pattern: /^\/organizations\/[^/]+\/pulse-handoff-link$/ },
  { methods: ANY, pattern: /^\/organizations\/[^/]+\/pulse-link-invites(\/.*)?$/ },
  { methods: ['PATCH', 'DELETE'], pattern: /^\/users\/[^/]+$/ }, // staffRoutes.js flat user edit/deactivate
  { methods: ['GET', 'POST', 'DELETE'], pattern: /^\/users\/[^/]+\/avatar$/ },
  { methods: ['PATCH'], pattern: /^\/users\/[^/]+\/password$/ },
];

router.use((req, res, next) => {
  const allowed = ALLOWED_ROUTES.some(
    ({ methods, pattern }) => methods.includes(req.method) && pattern.test(req.path)
  );
  if (!allowed) return res.status(404).json({ error: 'Not found' });
  next();
});

// Users management and the Rhythm Engine dashboard are admin-only for
// self-service Enterprise clients (matches the nav, which only shows
// those links to role === 'admin'); Dashboard/Tasks are open to both
// admin and employee. Every request reaching this point is already known
// to be from an Enterprise client-org caller (requireEnterpriseClientSelf
// ran first), so this check applies unconditionally.
const ADMIN_ONLY_PATH_PATTERNS = [
  /^\/organizations\/[^/]+\/users(\/.*)?$/,
  /^\/organizations\/[^/]+\/invites$/,
  /^\/organizations\/[^/]+\/pulse-(dashboard|sessions|timepoints|trend-signals|handoff-link|link-invites)(\/.*)?$/,
  /^\/users\/[^/]+(\/.*)?$/,
];
router.use((req, res, next) => {
  if (req.user.role === 'admin') return next();
  const requiresAdmin = ADMIN_ONLY_PATH_PATTERNS.some((re) => re.test(req.path));
  if (requiresAdmin) return res.status(403).json({ error: 'Admin only' });
  next();
});

// Belt-and-suspenders on top of the canPlatformUserAccessClientOrgPure
// client-self branch (shared.js): the :id/:orgId route param must always
// equal the caller's own org. Several reused handlers (e.g. in
// taskRoutes.js) don't re-run the pure-function check themselves and rely
// entirely on the router they're mounted behind for authorization — this
// makes that authorization explicit here too, not just implicit in the
// allowlist + gate above.
router.param(['id', 'orgId'], (req, res, next, value) => {
  if (String(value) !== String(req.user.organizationId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});

registerPlatformOrgRoutes(router);
registerPlatformStaffRoutes(router);
router.use(platformTaskRoutes);

export default router;
