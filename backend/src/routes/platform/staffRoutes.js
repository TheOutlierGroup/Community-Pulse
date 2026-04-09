import fs from 'fs';
import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import { requireBodyFields } from '../../middleware/validation.js';
import { extensionForUpload } from '../../middleware/avatarUpload.js';
import { avatarFilePath } from '../../config/storage.js';
import * as Organization from '../../models/Organization.js';
import * as User from '../../models/User.js';
import * as Invite from '../../models/Invite.js';
import * as PasswordResetToken from '../../models/PasswordResetToken.js';
import {
  handlePlatformUserCreateUpload,
  publicStaffUser,
  sendAvatarFileOr404,
} from './shared.js';
import { isResendConfigured, sendPlatformWelcomeEmail } from '../../services/email.js';

const PLATFORM_WELCOME_RESET_MS = 7 * 24 * 60 * 60 * 1000;

function resolvePublicAppBaseUrl() {
  const raw =
    process.env.CRM_APP_URL
    || process.env.APP_URL
    || String(process.env.FRONTEND_ORIGIN || '').split(',')[0].trim();
  return raw ? raw.replace(/\/$/, '') : '';
}

function parsePagination(query) {
  const rawLimit = Number.parseInt(String(query?.limit ?? ''), 10);
  const rawOffset = Number.parseInt(String(query?.offset ?? ''), 10);
  return {
    limit: Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 200,
    offset: Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0,
  };
}

export function registerPlatformStaffRoutes(router) {
  router.get('/staff', async (req, res) => {
    const users = await User.listUsersForOrg(req.user.organizationId, parsePagination(req.query));
    res.json({ users: users.map(publicStaffUser) });
  });

  router.get('/users/:userId/avatar', async (req, res) => {
    const target = await User.findUserById(req.params.userId);
    if (!target || target.deactivated_at || target.organization_id !== req.user.organizationId) {
      return res.status(404).end();
    }
    const name = await User.getProfileAvatarFilename(req.params.userId);
    if (!name) return res.status(404).end();
    sendAvatarFileOr404(res, name);
  });

  router.post('/users', handlePlatformUserCreateUpload, async (req, res) => {
    const firstName = req.body.firstName ?? '';
    const lastName = req.body.lastName ?? '';
    const email = req.body.email;
    const password = req.body.password;
    const role = req.body.role === 'employee' ? 'employee' : 'admin';
    if (!email || String(email).trim() === '') {
      return res.status(400).json({ error: 'Email is required' });
    }
    const trimmedPassword = password != null ? String(password).trim() : '';
    if (trimmedPassword.length > 0 && trimmedPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const baseUrl = resolvePublicAppBaseUrl();
    if (trimmedPassword.length === 0) {
      if (!baseUrl) {
        return res.status(400).json({
          error:
            'Set CRM_APP_URL (or APP_URL/FRONTEND_ORIGIN fallback) to create a user without an initial password, or provide a password (8+ characters).',
        });
      }
      if (!isResendConfigured()) {
        return res.status(503).json({
          error: 'Email is not configured',
          details:
            'Add RESEND_API_KEY to create users without an initial password, or set an initial password (8+ characters).',
        });
      }
    }
    const existing = await User.findUserByEmail(String(email));
    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }
    const hash =
      trimmedPassword.length >= 8
        ? await bcrypt.hash(trimmedPassword, 12)
        : await bcrypt.hash(randomBytes(32).toString('base64url'), 12);
    const row = await User.createUserWithProfile({
      email: String(email).trim(),
      passwordHash: hash,
      role,
      organizationId: req.user.organizationId,
      firstName,
      lastName,
    });
    let outRow = await User.findUserById(row.id);
    if (req.file) {
      const ext = extensionForUpload(req.file);
      const base = `${row.id}${ext || '.png'}`;
      try {
        await fs.promises.writeFile(avatarFilePath(base), req.file.buffer);
        await User.setProfileAvatarFilename(row.id, base);
        outRow = await User.findUserById(row.id);
      } catch (e) {
        console.error(e);
      }
    }

    let welcomeEmailSent = false;
    if (baseUrl && isResendConfigured()) {
      try {
        const resetToken = await PasswordResetToken.createResetToken(row.id, {
          expiresInMs: PLATFORM_WELCOME_RESET_MS,
        });
        const loginUrl = `${baseUrl}/login`;
        const setPasswordUrl = `${baseUrl}/reset-password/${resetToken}`;
        const org = await Organization.getOrganization(req.user.organizationId);
        const displayName = [firstName, lastName]
          .map((s) => String(s || '').trim())
          .filter(Boolean)
          .join(' ');
        await sendPlatformWelcomeEmail(
          String(email).trim(),
          displayName,
          loginUrl,
          setPasswordUrl,
          org?.name || 'Outlier'
        );
        welcomeEmailSent = true;
      } catch (e) {
        console.error('Platform welcome email failed:', e);
      }
    }

    res.status(201).json({ user: publicStaffUser(outRow), welcomeEmailSent });
  });

  router.patch('/users/:userId', async (req, res) => {
    const { userId } = req.params;
    const target = await User.findUserById(userId);
    if (!target || target.deactivated_at || target.organization_id !== req.user.organizationId) {
      return res.status(404).json({ error: 'User not found' });
    }
    const body = req.body || {};
    const patch = {};
    if ('firstName' in body) patch.firstName = body.firstName;
    if ('lastName' in body) patch.lastName = body.lastName;
    if ('email' in body) patch.email = body.email;
    if ('role' in body) patch.role = body.role;
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    if ('email' in patch) {
      const em = String(patch.email).toLowerCase().trim();
      if (!em) return res.status(400).json({ error: 'Email is required' });
      const ex = await User.findUserByEmail(em);
      if (ex && ex.id !== userId) {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }
      patch.email = em;
    }
    const row = await User.updateStaffUserInOrg(userId, req.user.organizationId, patch);
    if (!row) return res.status(404).json({ error: 'User not found' });
    res.json({ user: publicStaffUser(row) });
  });

  router.delete('/users/:userId', async (req, res) => {
    const { userId } = req.params;
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'You cannot remove your own access' });
    }
    const target = await User.findUserById(userId);
    if (!target || target.deactivated_at) {
      return res.status(404).json({ error: 'User not found' });
    }
    const requesterOrg = await Organization.getOrganization(req.user.organizationId);
    if (!requesterOrg || requesterOrg.kind !== 'platform') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const targetOrg = await Organization.getOrganization(target.organization_id);
    if (!targetOrg) {
      return res.status(404).json({ error: 'User not found' });
    }
    const allowed =
      targetOrg.kind === 'client' ||
      (targetOrg.kind === 'platform' && target.organization_id === req.user.organizationId);
    if (!allowed) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const ok = await User.deactivateUserInOrg(userId, target.organization_id);
    if (!ok) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  });

  router.post('/users/:userId/avatar', handlePlatformUserCreateUpload, async (req, res) => {
    const { userId } = req.params;
    const target = await User.findUserById(userId);
    if (!target || target.deactivated_at || target.organization_id !== req.user.organizationId) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const prev = await User.getProfileAvatarFilename(userId);
    const ext = extensionForUpload(req.file);
    const base = `${userId}${ext || '.png'}`;
    try {
      if (prev && prev !== base) {
        try {
          await fs.promises.unlink(avatarFilePath(prev));
        } catch {
          /* ignore */
        }
      }
      await fs.promises.writeFile(avatarFilePath(base), req.file.buffer);
      await User.setProfileAvatarFilename(userId, base);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Could not save image' });
    }
    const outRow = await User.findUserById(userId);
    res.json({ user: publicStaffUser(outRow) });
  });

  router.delete('/users/:userId/avatar', async (req, res) => {
    const { userId } = req.params;
    const target = await User.findUserById(userId);
    if (!target || target.deactivated_at || target.organization_id !== req.user.organizationId) {
      return res.status(404).json({ error: 'User not found' });
    }
    const prev = await User.clearProfileAvatarFilename(userId);
    if (prev) {
      try {
        await fs.promises.unlink(avatarFilePath(prev));
      } catch {
        /* ignore */
      }
    }
    const outRow = await User.findUserById(userId);
    res.json({ user: publicStaffUser(outRow) });
  });

  router.post('/staff/invites', requireBodyFields(['email']), async (req, res) => {
    const email = req.body.email;
    const existing = await User.findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
    const invite = await Invite.createInvite({
      email,
      token,
      organizationId: req.user.organizationId,
      expiresAt,
      invitedRole: 'admin',
      firstName: req.body.firstName,
      lastName: req.body.lastName,
    });
    res.status(201).json({
      invite: {
        id: invite.id,
        email: invite.email,
        expiresAt: invite.expires_at,
      },
      inviteUrl: `/invite/${token}`,
    });
  });

  router.patch('/users/:userId/password', requireBodyFields(['password']), async (req, res) => {
    const { password } = req.body;
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const target = await User.getUserOrgKind(req.params.userId);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }
    const requesterOrg = await Organization.getOrganization(req.user.organizationId);
    if (!requesterOrg || requesterOrg.kind !== 'platform') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const allowed =
      target.kind === 'client' ||
      (target.kind === 'platform' && target.organization_id === req.user.organizationId);
    if (!allowed) {
      return res.status(403).json({ error: 'Cannot update this user' });
    }
    const hash = await bcrypt.hash(password, 12);
    const updated = await User.updateUserPassword(req.params.userId, hash);
    if (!updated) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  });
}
