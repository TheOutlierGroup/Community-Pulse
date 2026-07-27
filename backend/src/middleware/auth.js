import jwt from 'jsonwebtoken';
import * as Organization from '../models/Organization.js';
import * as User from '../models/User.js';
import * as LicenseConfig from '../models/LicenseConfig.js';
import {
  CLIENT_SERVICE_PULSE,
  organizationHasService,
  organizationHasEnterprisePortalTier,
} from '../services/clientServices.js';
import { recordAuditEvent, AUDIT_ACTIONS } from '../services/auditLog.js';

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is required');
  return s;
}

function jwtOptions() {
  const opts = { algorithms: ['HS256'] };
  if (process.env.JWT_ISSUER) opts.issuer = process.env.JWT_ISSUER;
  if (process.env.JWT_AUDIENCE) opts.audience = process.env.JWT_AUDIENCE;
  return opts;
}

export function signToken(payload, { expiresIn } = {}) {
  return jwt.sign(payload, getSecret(), {
    algorithm: 'HS256',
    expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || '7d',
    issuer: process.env.JWT_ISSUER || undefined,
    audience: process.env.JWT_AUDIENCE || undefined,
  });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let decoded;
  try {
    decoded = jwt.verify(token, getSecret(), jwtOptions());
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  (async () => {
    try {
      const authState = await User.getAuthStateForUser(decoded.sub);
      if (!authState) {
        return res.status(401).json({ error: 'Account is no longer active' });
      }
      // PT-05: role, organizationId, organizationKind and mfaVerifiedAt
      // below are all read from the token, which lives for 7 days by
      // default. Without this check a demotion, org move, MFA change or
      // password reset left every already-issued token running on the
      // privileges it was minted with until it expired on its own.
      if (sessionRevoked(authState.sessionsInvalidatedAt, decoded.iat)) {
        return res.status(401).json({ error: 'Session is no longer valid. Please sign in again.' });
      }
      req.user = {
        id: decoded.sub,
        role: decoded.role,
        organizationId: decoded.organizationId,
        organizationKind: decoded.organizationKind,
        mfaVerifiedAt: decoded.mfaVerifiedAt || null,
        // SUP-01: when the token was minted via the impersonation flow,
        // these fields carry the platform admin's identity for audit
        // logging and tell the write guard below to refuse mutations.
        supportImpersonation: Boolean(decoded.supportImpersonation),
        supportActorUserId: decoded.supportActorUserId || null,
        supportTargetOrgId: decoded.supportTargetOrgId || null,
      };
      // SUP-01 write guard, enforced here (inside requireAuth itself)
      // rather than as a separately-mounted middleware, so a read-only
      // impersonation session can never reach a write endpoint no matter
      // which router handles it (/api/platform, /api/admin, /api/analytics,
      // /api/pulse, /api/rhythm-engine, /api/reports, /api/auth/me, ...) —
      // a router that forgets to mount a write-guard can't reopen this gap.
      if (isImpersonationBlockedWrite(req.user, req.method)) {
        // Fire-and-forget: the blocked write itself shouldn't wait on a
        // DB round-trip, and recordAuditEvent already swallows its own
        // errors. Attributed to the real staff actor (supportActorUserId),
        // not req.user.id, which during impersonation is the target org's
        // impersonated user.
        recordAuditEvent({
          actor: { id: req.user.supportActorUserId, role: 'admin', organizationId: null },
          action: AUDIT_ACTIONS.SUPPORT_IMPERSONATE_BLOCKED_WRITE,
          targetType: 'organization',
          targetId: req.user.supportTargetOrgId,
          targetOrganizationId: req.user.supportTargetOrgId,
          result: 'blocked',
          ipAddress: req.ip,
          userAgent: req.get?.('user-agent') || null,
          metadata: { method: req.method, path: req.originalUrl, impersonatedUserId: req.user.id },
        });
        return res.status(403).json({ error: 'Read-only support session: writes are disabled' });
      }
      next();
    } catch (e) {
      next(e);
    }
  })();
}

/**
 * PT-05: has this token been revoked by a later privilege change?
 *
 * `iat` is whole seconds, while sessions_invalidated_at carries
 * milliseconds, so a token minted in the same second as the invalidation
 * that caused it — the ordinary "change your password, get a fresh
 * token" flow — would otherwise floor to just before the stamp and log
 * the user straight back out. The one-second grace covers that rounding.
 * The cost is that a token issued in the second before a revocation
 * survives it, which is not a meaningful window for an attacker who
 * would already need the token.
 *
 * Exported as a pure predicate so the boundary cases are testable
 * without a database.
 */
export function sessionRevoked(sessionsInvalidatedAt, issuedAtSeconds) {
  if (!sessionsInvalidatedAt) return false;
  const invalidatedMs = new Date(sessionsInvalidatedAt).getTime();
  if (!Number.isFinite(invalidatedMs)) return false;
  // A token with no iat predates any stamp we can compare against, so
  // treat it as revoked rather than trusting it.
  if (!Number.isFinite(issuedAtSeconds)) return true;
  return issuedAtSeconds * 1000 + 1000 < invalidatedMs;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Pure predicate (exported for unit testing without spinning up Express).
export function isImpersonationBlockedWrite(user, method) {
  return Boolean(user?.supportImpersonation) && !SAFE_METHODS.has(method);
}

// PT-04: single source of truth for "is admin MFA satisfied for this
// request". Previously each admin gate re-implemented (or, more often,
// silently omitted) this check — requireAdmin had it, every gate on the
// /api/platform surface did not, so MFA_ENFORCE_ADMIN protected the
// client-org routes and nothing else. Keep every admin gate routed
// through here so the next one added can't quietly skip it.
export function adminMfaEnforced() {
  return String(process.env.MFA_ENFORCE_ADMIN || 'true').trim().toLowerCase() !== 'false';
}

// Unconditional form, for gates that already enforced MFA before PT-04
// (requireAdmin, on the client-org /api/admin and /api/analytics
// surfaces). Left as-is so this change never weakens an existing check.
export function adminMfaSatisfied(user) {
  if (!adminMfaEnforced()) return true;
  return Boolean(user?.mfaVerifiedAt);
}

function callerOrganizationKind(req) {
  // Prefer the DB-fresh org resolved by requireWorkspaceUser /
  // requirePlatformOnlyUser upstream; fall back to the JWT claim for
  // gates that run without one.
  return (
    req?.workspaceOrganization?.kind
    || req?.platformOrganization?.kind
    || req?.user?.organizationKind
    || null
  );
}

/**
 * PT-04, scoped form — for the /api/platform gates that were role-only
 * until now.
 *
 * MFA_ENFORCE_ADMIN is documented as forcing TOTP for *platform* admins
 * (Outlier staff). That scoping matters here and is not incidental:
 * staffRoutes, apiKeyRoutes, announcementRoutes, businessUnitRoutes,
 * quizRoutes and webhookRoutes are all mounted on platformRouter BEFORE
 * requirePlatformOnlyUser, so a licensee (Practitioner) admin reaches
 * them too. Enforcing MFA on that population would lock paying customers
 * out of their own workspace on deploy — a much larger blast radius than
 * the gap being closed, and a separate product decision.
 *
 * So: enforce for platform-org admins, leave licensee admins as they were.
 */
export function platformAdminMfaSatisfied(req) {
  if (!adminMfaEnforced()) return true;
  if (callerOrganizationKind(req) !== 'platform') return true;
  return Boolean(req?.user?.mfaVerifiedAt);
}

// Actionable on purpose: a platform admin who has never enrolled is
// locked out of the whole platform surface by this gate, and the way
// out (enrol, then re-authenticate so the claim is minted) is not
// guessable from a bare "MFA required".
const MFA_REQUIRED_ERROR =
  'Multi-factor authentication is required for admin actions. Set it up under Account → Security, then sign in again.';

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  if (!adminMfaSatisfied(req.user)) {
    return res.status(403).json({ error: MFA_REQUIRED_ERROR, mfaRequired: true });
  }
  next();
}

export async function requireClientOrganization(req, res, next) {
  try {
    const org = req.clientOrganization || (await Organization.getOrganization(req.user.organizationId));
    if (!org || org.kind !== 'client') {
      return res.status(403).json({ error: 'Client organization only' });
    }
    req.clientOrganization = org;
    next();
  } catch (e) {
    next(e);
  }
}

export async function requirePlatformAdmin(req, res, next) {
  try {
    const org = await Organization.getOrganization(req.user.organizationId);
    if (!org || org.kind !== 'platform') {
      return res.status(403).json({ error: 'Platform only' });
    }
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    if (!platformAdminMfaSatisfied(req)) {
      return res.status(403).json({ error: MFA_REQUIRED_ERROR, mfaRequired: true });
    }
    req.platformOrganization = org;
    next();
  } catch (e) {
    next(e);
  }
}

export async function requirePlatformUser(req, res, next) {
  try {
    const org = await Organization.getOrganization(req.user.organizationId);
    if (!org || org.kind !== 'platform') {
      return res.status(403).json({ error: 'Platform only' });
    }
    req.platformOrganization = org;
    next();
  } catch (e) {
    next(e);
  }
}

// A workspace user is anyone who can run a platform-style CRM workspace:
// either Outlier platform staff or a licensee admin/employee. Both share the
// same /platform/* API surface but with different scoping rules applied per
// route (see scopeable helpers in routes/platform/shared.js).
export async function requireWorkspaceUser(req, res, next) {
  try {
    const org = await Organization.getOrganization(req.user.organizationId);
    if (!org || (org.kind !== 'platform' && org.kind !== 'licensee')) {
      return res.status(403).json({ error: 'Workspace access required' });
    }
    if (org.kind === 'licensee') {
      const config = await LicenseConfig.getForOrganization(org.id);
      // SUP-01: support impersonation can read a suspended/expired
      // licensee's workspace — that's literally why the feature exists.
      // Writes are still blocked by requireAuth's write guard.
      if (!req.user?.supportImpersonation && config && !LicenseConfig.isLicenseActive(config)) {
        const reason =
          config.status === 'expired'
            ? 'Your Rhythm Engine licence has expired. Contact Outlier to renew.'
            : config.status === 'suspended'
              ? 'Your Rhythm Engine licence has been suspended. Contact Outlier for support.'
              : 'Your Rhythm Engine licence is not active.';
        return res.status(402).json({ error: reason, licenceStatus: config.status });
      }
      req.licenseeLicenseConfig = config || null;
    }
    req.workspaceOrganization = org;
    if (org.kind === 'platform') req.platformOrganization = org;
    else req.licenseeOrganization = org;
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Admin gate for routes that already have workspace/org scoping upstream.
 * Call AFTER requireAuth (and usually after requireWorkspaceUser /
 * requirePlatformOnlyUser) — this asserts `role === 'admin'` plus admin
 * MFA, but does NOT re-check the org kind. Use requirePlatformAdmin when
 * you also need "the caller's org is platform-kind" asserted in one go.
 *
 * PT-04: this is the gate the whole /api/platform surface runs on, so the
 * MFA check has to live here. It previously checked the role alone, which
 * meant MFA_ENFORCE_ADMIN protected /api/admin and /api/analytics — the
 * client-org surfaces — while org creation, licence config, staff
 * management, API keys, webhooks and the GDPR endpoints were role-only.
 */
export function requirePlatformAdminRole(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  if (!platformAdminMfaSatisfied(req)) {
    return res.status(403).json({ error: MFA_REQUIRED_ERROR, mfaRequired: true });
  }
  next();
}

/**
 * Read-only Users/Settings access for the platform-org 'platform' tier
 * (Level 1), on top of admin. A licensee-org user can never hold role
 * 'platform' (only platform-kind orgs assign it — see PLATFORM_ORG_ROLES
 * in models/User.js), so this naturally leaves licensee gating exactly as
 * admin-only, matching current behavior for that surface.
 */
export function requireAtLeastPlatformTier(req, res, next) {
  if (req.user?.role === 'admin' || req.user?.role === 'platform') {
    return next();
  }
  return res.status(403).json({ error: 'Admin only' });
}

// Block routes that should only ever be reachable by Outlier platform staff
// (e.g. tasks, platform-wide service catalog, super-admin tooling).
export function requirePlatformOnlyUser(req, res, next) {
  const kind = req.workspaceOrganization?.kind;
  if (kind && kind !== 'platform') {
    return res.status(403).json({ error: 'Not available to licensees' });
  }
  if (kind) return next();
  // If requireWorkspaceUser was not run upstream, fall back to a defensive lookup.
  return Organization.getOrganization(req.user?.organizationId).then((org) => {
    if (!org || org.kind !== 'platform') {
      return res.status(403).json({ error: 'Not available to licensees' });
    }
    req.workspaceOrganization = org;
    req.platformOrganization = org;
    return next();
  }).catch(next);
}

export function buildRequireClientPulseService({
  getOrganization = Organization.getOrganization,
} = {}) {
  return async function requireClientPulseService(req, res, next) {
    try {
      const org = req.clientOrganization || (await getOrganization(req.user.organizationId));
      if (!org || org.kind !== 'client') {
        return res.status(403).json({ error: 'Client organization only' });
      }
      req.clientOrganization = org;
      if (!organizationHasService(org.settings, CLIENT_SERVICE_PULSE)) {
        return res.status(403).json({ error: 'Rhythm Engine is not enabled for this client' });
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

export const requireClientPulseService = buildRequireClientPulseService();

// Gate for the Enterprise client self-service workspace router
// (platformEnterpriseSelfRouter.js), which is mounted BEFORE the main
// platformRouter at the same '/api/platform' prefix. When the caller is
// NOT an Enterprise-tier client org, this calls next('router') to exit the
// self-service router entirely and defer to platformRouter's own
// (unchanged) requireWorkspaceUser gate — it must never respond with an
// error itself in that case, or every staff/licensee request would break.
//
// Deliberately does NOT set req.workspaceOrganization/req.platformOrganization/
// req.licenseeOrganization — reused handlers from
// orgRoutes.js/taskRoutes.js/staffRoutes.js already degrade correctly when
// those are undefined (they were written to run behind requireWorkspaceUser,
// which never lets a client org through, so a client-org caller reaching
// them here is new — but every place that reads those fields uses optional
// chaining and falls back to non-platform/non-licensee defaults).
export async function requireEnterpriseClientSelf(req, res, next) {
  try {
    const org = await Organization.getOrganization(req.user.organizationId);
    if (!org || org.kind !== 'client' || !organizationHasEnterprisePortalTier(org.settings)) {
      return next('router');
    }
    req.enterpriseClientOrganization = org;
    next();
  } catch (e) {
    next(e);
  }
}
