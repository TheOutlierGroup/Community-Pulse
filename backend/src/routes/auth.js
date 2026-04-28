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
import * as Organization from '../models/Organization.js';
import * as PasswordResetToken from '../models/PasswordResetToken.js';
import { consumePulseHandoffToken } from '../security/pulseHandoffToken.js';
import { sendPasswordResetEmail } from '../services/email.js';
import { generateMfaSecret, verifyTotpCode } from '../services/mfa.js';
import {
  consumeDashboardLoginToken,
  issueDashboardLoginToken,
} from '../services/clientDashboardAuth.js';
import { logAuditEvent } from '../services/auditLog.js';
import {
  clientServiceCatalogFromPlatformSettings,
  enabledServicesFromOrganizationSettings,
  normalizeClientServiceIds,
} from '../services/clientServices.js';

const router = Router();

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
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
    if (user.role === 'admin' && user.mfa_enabled) {
      const mfaCode = String(req.body?.mfaCode || '').trim();
      const validMfa = verifyTotpCode(mfaCode, user.mfa_secret);
      if (!validMfa) {
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
  const saved = await User.storeMfaSecret(req.user.id, secret);
  if (!saved) return res.status(404).json({ error: 'User not found' });
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
  res.json({ mfaSecret: secret, requiresVerification: true });
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
      return res.status(400).json({ error: 'User already exists — use login' });
    }
    const invitedRole = invite.invited_role === 'admin' ? 'admin' : 'employee';
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
