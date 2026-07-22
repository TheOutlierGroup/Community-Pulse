import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { signToken, requireAuth } from '../middleware/auth.js';
import { requireBodyFields } from '../middleware/validation.js';
import { uploadAvatarMiddleware } from '../middleware/avatarUpload.js';
import multer from 'multer';
import { avatarFilePath, ensureStorageDirs, orgLogoFilePath } from '../config/storage.js';
import { extensionForUpload } from '../middleware/avatarUpload.js';
import * as User from '../models/User.js';
import * as Invite from '../models/Invite.js';
import * as LicenseConfig from '../models/LicenseConfig.js';
import * as Organization from '../models/Organization.js';
import * as PasswordResetToken from '../models/PasswordResetToken.js';
import { consumePulseHandoffToken } from '../security/pulseHandoffToken.js';
import { sendPasswordResetEmail } from '../services/email.js';
import {
  buildTotpUri,
  consumeRecoveryCode,
  generateMfaSecret,
  generateRecoveryCodes,
  qrCodeDataUrlForUri,
  verifyTotpCode,
} from '../services/mfa.js';
import {
  consumeDashboardLoginToken,
  issueDashboardLoginToken,
} from '../services/clientDashboardAuth.js';
import { logAuditEvent } from '../services/auditLog.js';
import {
  clientServiceCatalogFromPlatformSettings,
  enabledServicesFromOrganizationSettings,
  normalizeClientServiceIds,
  clientPortalTierFromOrganizationSettings,
} from '../services/clientServices.js';
import { resolveBrandForOrganization, publicBrand } from '../services/licenseeBrand.js';
import { buildLicenseeOnboardingChecklist } from '../services/licenseeOnboarding.js';

const router = Router();

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  // Object message -> real JSON body (see platformRouter.js's platformLimiter
  // for why the default string message breaks every caller's `.error` read).
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

function publicUser(u) {
  const enabledServices = deriveEnabledServices(u);
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    organizationId: u.organization_id,
    organizationKind: u.organization_kind,
    organizationName: u.organization_name,
    firstName: u.first_name ?? '',
    lastName: u.last_name ?? '',
    hasProfileAvatar: Boolean(u.profile_avatar_filename),
    organizationHasCompanyLogo: Boolean(u.organization_company_logo_filename),
    mfaEnabled: Boolean(u.mfa_enabled),
    enabledServices,
    clientPortalTier:
      u.organization_kind === 'client'
        ? clientPortalTierFromOrganizationSettings(u.organization_settings)
        : null,
  };
}

function deriveEnabledServices(userRow) {
  if (userRow.organization_kind !== 'client') return [];
  return enabledServicesFromOrganizationSettings(userRow.organization_settings);
}

router.post(
  '/login',
  authLimiter,
  requireBodyFields(['email', 'password']),
  async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findUserByEmailWithOrg(email);
    if (!user || !user.login_enabled) {
      await logAuditEvent({
        action: 'auth.login',
        targetType: 'user',
        targetId: String(email || '').trim().toLowerCase(),
        result: 'invalid_credentials',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      await logAuditEvent({
        actor: {
          id: user.id,
          role: user.role,
          organizationId: user.organization_id,
        },
        action: 'auth.login',
        targetType: 'user',
        targetId: user.id,
        targetOrganizationId: user.organization_id,
        result: 'invalid_credentials',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user.organization_kind === 'licensee') {
      const config = await LicenseConfig.getForOrganization(user.organization_id);
      if (config && !LicenseConfig.isLicenseActive(config)) {
        await logAuditEvent({
          actor: { id: user.id, role: user.role, organizationId: user.organization_id },
          action: 'auth.login',
          targetType: 'user',
          targetId: user.id,
          targetOrganizationId: user.organization_id,
          result: 'licence_inactive',
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });
        const reason =
          config.status === 'expired'
            ? 'Your Rhythm Engine licence has expired. Contact Outlier to renew.'
            : 'Your Rhythm Engine licence is not active. Contact Outlier for support.';
        return res.status(402).json({ error: reason, licenceStatus: config.status });
      }
    }
    if (user.role === 'admin' && user.mfa_enabled) {
      const mfaCode = String(req.body?.mfaCode || '').trim();
      const validTotp = verifyTotpCode(mfaCode, user.mfa_secret);
      const recoveryCodeHashes = Array.isArray(user.mfa_recovery_codes) ? user.mfa_recovery_codes : [];
      const { consumed, remainingCodeHashes } = consumeRecoveryCode(mfaCode, recoveryCodeHashes);
      if (!validTotp && !consumed) {
        await logAuditEvent({
          actor: {
            id: user.id,
            role: user.role,
            organizationId: user.organization_id,
          },
          action: 'auth.login',
          targetType: 'user',
          targetId: user.id,
          targetOrganizationId: user.organization_id,
          result: 'mfa_required',
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });
        return res.status(401).json({ error: 'MFA code is required' });
      }
      if (consumed) {
        await User.replaceMfaRecoveryCodeHashes(user.id, remainingCodeHashes);
      }
      await User.updateLastMfaVerifiedAt(user.id);
    }
    const token = signToken({
      sub: user.id,
      role: user.role,
      organizationId: user.organization_id,
      organizationKind: user.organization_kind,
      mfaVerifiedAt: user.mfa_enabled ? new Date().toISOString() : null,
    });
    await logAuditEvent({
      actor: {
        id: user.id,
        role: user.role,
        organizationId: user.organization_id,
      },
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
      targetOrganizationId: user.organization_id,
      result: 'ok',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.json({
      token,
      user: publicUser(user),
    });
  }
);

router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findUserByIdWithOrg(req.user.id);
  if (!user || user.deactivated_at || !user.login_enabled) {
    return res.status(401).json({ error: 'Account is no longer active' });
  }
  res.json(publicUser(user));
});

/**
 * INF-06: brand the UI should render for the authenticated user. Returns
 * null when the user is on a platform-direct workspace (frontend falls
 * back to default Outlier brand) or when the parent licensee has chosen
 * not to white-label downstream clients.
 */
router.get('/me/brand', requireAuth, async (req, res) => {
  if (!req.user?.organizationId) return res.json({ brand: null });
  try {
    const brand = await resolveBrandForOrganization(req.user.organizationId);
    res.json({ brand: publicBrand(brand) });
  } catch (error) {
    console.error('Failed to resolve brand for user:', error);
    res.json({ brand: null });
  }
});

/**
 * ONB-02 setup checklist for the current licensee admin. Returns
 * `{ checklist: null }` for non-licensees so the frontend can use the
 * same call regardless of org kind without crashing on a 404.
 */
router.get('/me/onboarding', requireAuth, async (req, res) => {
  if (!req.user?.organizationId) return res.json({ checklist: null });
  try {
    if (req.user.role !== 'admin') return res.json({ checklist: null });
    const organization = await Organization.getOrganization(req.user.organizationId);
    if (!organization || organization.kind !== 'licensee') {
      return res.json({ checklist: null });
    }
    const checklist = await buildLicenseeOnboardingChecklist({ user: req.user, organization });
    res.json({ checklist });
  } catch (error) {
    console.error('Failed to build onboarding checklist:', error);
    res.json({ checklist: null });
  }
});

/**
 * COM-03 notification preferences. GET returns the merged blob; PATCH
 * accepts a partial JSON object that's deep-merged into the stored
 * value. We deliberately don't validate the keys here — that lets us
 * add new toggles client-side without backend changes — but we cap the
 * payload size for safety.
 */
router.get('/me/notification-preferences', requireAuth, async (req, res, next) => {
  try {
    const prefs = await User.getNotificationPreferences(req.user.id);
    res.json({ preferences: prefs });
  } catch (e) {
    next(e);
  }
});

router.patch('/me/notification-preferences', requireAuth, async (req, res, next) => {
  try {
    const patch = req.body && typeof req.body === 'object' ? req.body : {};
    if (JSON.stringify(patch).length > 4000) {
      return res.status(413).json({ error: 'Preferences payload too large' });
    }
    const updated = await User.setNotificationPreferences(req.user.id, patch);
    res.json({ preferences: updated || {} });
  } catch (e) {
    next(e);
  }
});

router.patch('/me', requireAuth, async (req, res) => {
  const body = req.body || {};
  const patch = {};
  if ('firstName' in body) patch.firstName = body.firstName;
  if ('lastName' in body) patch.lastName = body.lastName;
  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: 'Provide firstName and/or lastName' });
  }
  const updated = await User.updateProfileNames(req.user.id, patch);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(publicUser(updated));
});

router.post('/mfa/setup', requireAuth, async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  const secret = generateMfaSecret();
  const { codes: recoveryCodes, codeHashes: recoveryCodeHashes } = generateRecoveryCodes();
  const saved = await User.storeMfaSecret(req.user.id, secret, recoveryCodeHashes);
  if (!saved) return res.status(404).json({ error: 'User not found' });
  const full = await User.findUserByIdWithOrg(req.user.id);
  const otpauthUri = buildTotpUri(secret, {
    email: full?.email || req.user.id,
    issuer: process.env.MFA_ISSUER,
  });
  const qrCodeDataUrl = await qrCodeDataUrlForUri(otpauthUri);
  await logAuditEvent({
    actor: req.user,
    action: 'auth.mfa_setup_started',
    targetType: 'user',
    targetId: req.user.id,
    targetOrganizationId: req.user.organizationId,
    result: 'ok',
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });
  res.json({
    mfaSecret: secret,
    otpauthUri,
    qrCodeDataUrl,
    recoveryCodes,
    requiresVerification: true,
  });
});

router.post('/mfa/verify', requireAuth, requireBodyFields(['code']), async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  const full = await User.findUserByIdWithOrg(req.user.id);
  if (!full?.mfa_secret) {
    return res.status(400).json({ error: 'MFA setup not initialized' });
  }
  if (!verifyTotpCode(req.body.code, full.mfa_secret)) {
    await logAuditEvent({
      actor: req.user,
      action: 'auth.mfa_verify',
      targetType: 'user',
      targetId: req.user.id,
      targetOrganizationId: req.user.organizationId,
      result: 'invalid_code',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    return res.status(401).json({ error: 'Invalid MFA code' });
  }
  await User.enableMfaForUser(req.user.id);
  await logAuditEvent({
    actor: req.user,
    action: 'auth.mfa_enabled',
    targetType: 'user',
    targetId: req.user.id,
    targetOrganizationId: req.user.organizationId,
    result: 'ok',
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });
  res.json({ ok: true, mfaEnabled: true });
});

router.post('/mfa/disable', requireAuth, requireBodyFields(['code']), async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  const full = await User.findUserByIdWithOrg(req.user.id);
  if (!full?.mfa_secret || !full?.mfa_enabled) {
    return res.status(400).json({ error: 'MFA is not enabled' });
  }
  if (!verifyTotpCode(req.body.code, full.mfa_secret)) {
    return res.status(401).json({ error: 'Invalid MFA code' });
  }
  await User.disableMfaForUser(req.user.id);
  await logAuditEvent({
    actor: req.user,
    action: 'auth.mfa_disabled',
    targetType: 'user',
    targetId: req.user.id,
    targetOrganizationId: req.user.organizationId,
    result: 'ok',
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });
  res.json({ ok: true, mfaEnabled: false });
});

router.post(
  '/me/password',
  authLimiter,
  requireAuth,
  requireBodyFields(['currentPassword', 'newPassword']),
  async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    const hash = await User.getPasswordHashByUserId(req.user.id);
    if (!hash) return res.status(404).json({ error: 'Not found' });
    const ok = await bcrypt.compare(currentPassword, hash);
    if (!ok) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const nextHash = await bcrypt.hash(newPassword, 12);
    await User.updateUserPassword(req.user.id, nextHash);
    res.json({ ok: true });
  }
);

function avatarContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return map[ext] || 'application/octet-stream';
}

router.get('/me/avatar', requireAuth, async (req, res) => {
  const name = await User.getProfileAvatarFilename(req.user.id);
  if (!name) return res.status(404).end();
  const safeName = path.basename(name);
  const full = path.resolve(avatarFilePath(safeName));
  const { avatarsDir } = ensureStorageDirs();
  const root = path.resolve(avatarsDir);
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return res.status(403).end();
  }
  if (!fs.existsSync(full)) return res.status(404).end();
  res.setHeader('Content-Type', avatarContentType(safeName));
  res.setHeader('Cache-Control', 'private, no-cache');
  res.sendFile(full);
});

router.post(
  '/me/avatar',
  requireAuth,
  (req, res, next) => {
    uploadAvatarMiddleware(req, res, (err) => {
      if (err) {
        const msg =
          err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 2MB or smaller' : err.message;
        return res.status(400).json({ error: msg || 'Upload failed' });
      }
      next();
    });
  },
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const prev = await User.getProfileAvatarFilename(req.user.id);
    if (prev && prev !== req.file.filename) {
      try {
        fs.unlinkSync(avatarFilePath(prev));
      } catch {
        /* ignore */
      }
    }
    await User.setProfileAvatarFilename(req.user.id, req.file.filename);
    const full = await User.findUserByIdWithOrg(req.user.id);
    res.json({ user: publicUser(full) });
  }
);

router.delete('/me/avatar', requireAuth, async (req, res) => {
  const prev = await User.clearProfileAvatarFilename(req.user.id);
  if (prev) {
    try {
      fs.unlinkSync(avatarFilePath(prev));
    } catch {
      /* ignore */
    }
  }
  const full = await User.findUserByIdWithOrg(req.user.id);
  res.json({ user: publicUser(full) });
});

function requireClientAdmin(req, res, next) {
  if (req.user?.organizationKind !== 'client' || req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Client admin only' });
  }
  next();
}

router.get('/me/organization-service-catalog', requireAuth, async (req, res) => {
  if (req.user?.organizationKind !== 'client') {
    return res.status(403).json({ error: 'Client users only' });
  }
  const platformOrg = await Organization.getFirstOrganizationByKind('platform');
  const services = clientServiceCatalogFromPlatformSettings(platformOrg?.settings);
  return res.json({ services });
});

router.patch('/me/organization-services', requireAuth, requireClientAdmin, async (req, res) => {
  const body = req.body || {};
  if (!Object.prototype.hasOwnProperty.call(body, 'services')) {
    return res.status(400).json({ error: 'services is required' });
  }
  if (!Array.isArray(body.services)) {
    return res.status(400).json({ error: 'services must be an array' });
  }
  const org = await Organization.getOrganization(req.user.organizationId);
  if (!org || org.kind !== 'client') {
    return res.status(404).json({ error: 'Organization not found' });
  }
  const baseSettings =
    org.settings && typeof org.settings === 'object' && !Array.isArray(org.settings)
      ? org.settings
      : {};
  const nextSettings = {
    ...baseSettings,
    services: normalizeClientServiceIds(
      body.services,
      clientServiceCatalogFromPlatformSettings(
        (await Organization.getFirstOrganizationByKind('platform'))?.settings
      ).map((service) => service.id)
    ),
  };
  if (Object.prototype.hasOwnProperty.call(nextSettings, 'pulseEnabled')) {
    delete nextSettings.pulseEnabled;
  }
  await Organization.updateOrganizationClient(org.id, { settings: nextSettings });
  const full = await User.findUserByIdWithOrg(req.user.id);
  res.json({ user: publicUser(full) });
});

const orgLogoClientUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (extensionForUpload(file)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, GIF, or WebP are allowed'));
  },
}).single('logo');

router.get('/me/organization-logo', requireAuth, async (req, res) => {
  if (req.user.organizationKind !== 'client') {
    return res.status(403).end();
  }
  const org = await Organization.getOrganization(req.user.organizationId);
  if (!org?.company_logo_filename) return res.status(404).end();
  const safeName = path.basename(org.company_logo_filename);
  const full = path.resolve(orgLogoFilePath(safeName));
  const { orgLogosDir } = ensureStorageDirs();
  const root = path.resolve(orgLogosDir);
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return res.status(403).end();
  }
  if (!fs.existsSync(full)) return res.status(404).end();
  res.setHeader('Content-Type', avatarContentType(safeName));
  res.setHeader('Cache-Control', 'private, no-cache');
  res.sendFile(full);
});

router.post(
  '/me/organization-logo',
  requireAuth,
  requireClientAdmin,
  (req, res, next) => {
    orgLogoClientUpload(req, res, (err) => {
      if (err) {
        const msg =
          err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 2MB or smaller' : err.message;
        return res.status(400).json({ error: msg || 'Upload failed' });
      }
      next();
    });
  },
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const orgId = req.user.organizationId;
    const ext = extensionForUpload(req.file);
    const base = `org-${orgId}${ext || '.png'}`;
    const org = await Organization.getOrganization(orgId);
    if (!org || org.kind !== 'client') {
      return res.status(404).json({ error: 'Organization not found' });
    }
    const prev = org.company_logo_filename;
    try {
      if (prev && prev !== base) {
        try {
          fs.unlinkSync(orgLogoFilePath(prev));
        } catch {
          /* ignore */
        }
      }
      fs.writeFileSync(orgLogoFilePath(base), req.file.buffer);
      await Organization.setCompanyLogoFilename(orgId, base);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Could not save logo' });
    }
    const full = await User.findUserByIdWithOrg(req.user.id);
    res.json({ user: publicUser(full) });
  }
);

router.delete('/me/organization-logo', requireAuth, requireClientAdmin, async (req, res) => {
  const orgId = req.user.organizationId;
  const prev = await Organization.clearCompanyLogoFilename(orgId);
  if (prev) {
    try {
      fs.unlinkSync(orgLogoFilePath(prev));
    } catch {
      /* ignore */
    }
  }
  const full = await User.findUserByIdWithOrg(req.user.id);
  res.json({ user: publicUser(full) });
});

router.post(
  ['/pulse-handoff/exchange', '/rhythm-engine-handoff/exchange'],
  authLimiter,
  requireBodyFields(['token']),
  async (req, res) => {
    const consumed = await consumePulseHandoffToken(req.body.token);
    if (!consumed) {
      return res.status(401).json({ error: 'Invalid or expired handoff token' });
    }

    const user = await User.findUserByIdWithOrg(consumed.user_id);
    if (!user || user.deactivated_at || !user.login_enabled) {
      return res.status(401).json({ error: 'Account is no longer active' });
    }

    const token = signToken({
      sub: user.id,
      role: user.role,
      organizationId: user.organization_id,
      organizationKind: user.organization_kind,
    });

    res.json({
      token,
      user: publicUser(user),
      targetOrganizationId: consumed.organization_id,
    });
  }
);

router.post(
  '/client-dashboard-tokens',
  requireAuth,
  requireBodyFields(['organizationId', 'contactEmail']),
  async (req, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const issued = await issueDashboardLoginToken({
      organizationId: req.body.organizationId,
      projectSessionId: req.body.projectSessionId || null,
      contactEmail: req.body.contactEmail,
      issuedByUserId: req.user.id,
    });
    await logAuditEvent({
      actor: req.user,
      action: 'auth.client_dashboard_token_issued',
      targetType: 'client_dashboard_token',
      targetId: issued.record.id,
      targetOrganizationId: issued.record.organization_id,
      result: 'ok',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      metadata: {
        contactEmail: issued.record.contact_email,
        expiresAt: issued.record.expires_at,
      },
    });
    res.status(201).json({
      token: issued.token,
      expiresAt: issued.record.expires_at,
      tokenId: issued.record.id,
    });
  }
);

router.post(
  '/client-dashboard-login',
  authLimiter,
  requireBodyFields(['organizationId', 'contactEmail', 'token']),
  async (req, res) => {
    const consumed = await consumeDashboardLoginToken({
      token: req.body.token,
      organizationId: req.body.organizationId,
      contactEmail: req.body.contactEmail,
    });
    if (!consumed) {
      await logAuditEvent({
        action: 'auth.client_dashboard_login',
        targetType: 'organization',
        targetId: req.body.organizationId,
        targetOrganizationId: req.body.organizationId,
        result: 'invalid_or_expired_token',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        metadata: { contactEmail: String(req.body.contactEmail || '').toLowerCase() },
      });
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const user = await User.findUserByEmailWithOrg(req.body.contactEmail);
    if (!user || user.organization_id !== req.body.organizationId) {
      return res.status(401).json({ error: 'No matching dashboard user account found' });
    }
    const token = signToken({
      sub: user.id,
      role: user.role,
      organizationId: user.organization_id,
      organizationKind: user.organization_kind,
      dashboardScope: 'client',
      projectSessionId: consumed.project_session_id || null,
    });
    await logAuditEvent({
      actor: {
        id: user.id,
        role: user.role,
        organizationId: user.organization_id,
      },
      action: 'auth.client_dashboard_login',
      targetType: 'client_dashboard_token',
      targetId: consumed.id,
      targetOrganizationId: consumed.organization_id,
      result: 'ok',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      metadata: { contactEmail: consumed.contact_email },
    });
    res.json({ token, user: publicUser(user) });
  }
);

router.post(
  '/forgot-password',
  authLimiter,
  requireBodyFields(['email']),
  async (req, res) => {
    const { email } = req.body;
    const user = await User.findUserByEmailWithOrg(email);

    // Always return success to avoid leaking which emails exist
    if (!user || !user.login_enabled) {
      return res.json({ ok: true });
    }

    try {
      const token = await PasswordResetToken.createResetToken(user.id);
      const baseUrl = process.env.CRM_APP_URL || process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      const resetUrl = `${baseUrl}/reset-password/${token}`;
      await sendPasswordResetEmail(user.email, resetUrl);
    } catch (err) {
      console.error('Password reset email failed:', err);
    }

    res.json({ ok: true });
  }
);

router.post(
  '/reset-password',
  authLimiter,
  requireBodyFields(['token', 'password']),
  async (req, res) => {
    const { token, password } = req.body;

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const resetToken = await PasswordResetToken.findValidToken(token);
    if (!resetToken) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const resetUser = await User.findUserById(resetToken.user_id);
    if (!resetUser || resetUser.deactivated_at || !resetUser.login_enabled) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const hash = await bcrypt.hash(password, 12);
    await User.updateUserPassword(resetToken.user_id, hash);
    await PasswordResetToken.markTokenUsed(resetToken.id);

    res.json({ ok: true });
  }
);

router.get('/invite/:token', authLimiter, async (req, res) => {
  const invite = await Invite.findValidInvite(req.params.token);
  if (!invite) {
    return res.status(404).json({ error: 'Invalid or expired invite' });
  }
  res.json({
    email: invite.email,
    organizationId: invite.organization_id,
    invitedRole: invite.invited_role || 'employee',
    firstName: invite.first_name ?? '',
    lastName: invite.last_name ?? '',
  });
});

router.post(
  '/accept-invite',
  authLimiter,
  requireBodyFields(['token', 'password']),
  async (req, res) => {
    const { token, password } = req.body;
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const invite = await Invite.findValidInvite(token);
    if (!invite) {
      return res.status(400).json({ error: 'Invalid or expired invite' });
    }
    const existing = await User.findUserByEmail(invite.email);
    if (existing) {
      if (
        existing.deactivated_at &&
        String(existing.organization_id) === String(invite.organization_id)
      ) {
        const invitedRole = invite.invited_role === 'admin' ? 'admin' : 'employee';
        if (invitedRole === 'admin') {
          const config = await LicenseConfig.getForOrganization(invite.organization_id);
          if (config) {
            const counts = await User.countActiveUsersByRoleForOrg(invite.organization_id);
            if ((counts.admin || 0) + 1 > config.admin_user_limit) {
              return res.status(402).json({
                error: `Admin user limit reached for this licence (${config.admin_user_limit}). Contact the platform owner to raise the limit.`,
              });
            }
          }
        }
        const okRe = await User.reactivateUserInOrg(existing.id, invite.organization_id);
        if (!okRe) {
          return res.status(400).json({ error: 'Invalid or expired invite' });
        }
        const hash = await bcrypt.hash(password, 12);
        await User.updateUserPassword(existing.id, hash);
        await User.updateStaffUserInOrg(existing.id, invite.organization_id, {
          firstName: invite.first_name,
          lastName: invite.last_name,
          role: invitedRole,
          loginEnabled: true,
        });
        await Invite.markInviteUsed(invite.id);
        const full = await User.findUserByIdWithOrg(existing.id);
        const jwt = signToken({
          sub: full.id,
          role: full.role,
          organizationId: full.organization_id,
          organizationKind: full.organization_kind,
        });
        return res.status(201).json({
          token: jwt,
          user: publicUser(full),
        });
      }
      if (!existing.deactivated_at) {
        return res.status(400).json({ error: 'User already exists — use login' });
      }
      return res.status(400).json({
        error:
          'This email is tied to an inactive account in another organization. Contact support if you need access.',
      });
    }
    const invitedRole = invite.invited_role === 'admin' ? 'admin' : 'employee';
    if (invitedRole === 'admin') {
      const config = await LicenseConfig.getForOrganization(invite.organization_id);
      if (config) {
        const counts = await User.countActiveUsersByRoleForOrg(invite.organization_id);
        if ((counts.admin || 0) >= config.admin_user_limit) {
          return res.status(402).json({
            error: `Admin user limit reached for this licence (${config.admin_user_limit}). Contact the platform owner to raise the limit.`,
          });
        }
      }
    }
    const hash = await bcrypt.hash(password, 12);
    const user = await User.createUserWithProfile({
      email: invite.email,
      passwordHash: hash,
      role: invitedRole,
      organizationId: invite.organization_id,
      firstName: invite.first_name,
      lastName: invite.last_name,
    });
    await Invite.markInviteUsed(invite.id);
    const full = await User.findUserByIdWithOrg(user.id);
    const jwt = signToken({
      sub: full.id,
      role: full.role,
      organizationId: full.organization_id,
      organizationKind: full.organization_kind,
    });
    res.status(201).json({
      token: jwt,
      user: publicUser(full),
    });
  }
);

export default router;
