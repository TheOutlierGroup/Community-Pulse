import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { signToken, requireAuth } from '../middleware/auth.js';
import { requireBodyFields } from '../middleware/validation.js';
import { uploadAvatarMiddleware } from '../middleware/avatarUpload.js';
import { avatarFilePath, ensureStorageDirs } from '../config/storage.js';
import * as User from '../models/User.js';
import * as Invite from '../models/Invite.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

function publicUser(u) {
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
  };
}

router.post(
  '/login',
  authLimiter,
  requireBodyFields(['email', 'password']),
  async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findUserByEmailWithOrg(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
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
    });
  }
);

router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findUserByIdWithOrg(req.user.id);
  if (!user || user.deactivated_at) {
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

router.get('/invite/:token', authLimiter, async (req, res) => {
  const invite = await Invite.findValidInvite(req.params.token);
  if (!invite) {
    return res.status(404).json({ error: 'Invalid or expired invite' });
  }
  res.json({
    email: invite.email,
    organizationId: invite.organization_id,
    invitedRole: invite.invited_role || 'employee',
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
    const user = await User.createUser({
      email: invite.email,
      passwordHash: hash,
      role: invitedRole,
      organizationId: invite.organization_id,
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
