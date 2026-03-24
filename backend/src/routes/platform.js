import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.js';
import { requireBodyFields } from '../middleware/validation.js';
import { extensionForUpload } from '../middleware/avatarUpload.js';
import { avatarFilePath, ensureStorageDirs } from '../config/storage.js';
import * as Organization from '../models/Organization.js';
import * as User from '../models/User.js';
import * as Invite from '../models/Invite.js';

const router = Router();

const platformLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(requireAuth, requirePlatformAdmin, platformLimiter);

function publicStaffUser(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    hasProfileAvatar: Boolean(row.profile_avatar_filename),
    createdAt: row.created_at,
  };
}

function platformAvatarContentType(filename) {
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

const platformUserCreateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (extensionForUpload(file)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, GIF, or WebP are allowed'));
  },
}).single('avatar');

router.get('/organizations', async (_req, res) => {
  const rows = await Organization.listOrganizationsByKind('client');
  res.json({ organizations: rows });
});

router.post('/organizations', requireBodyFields(['name']), async (req, res) => {
  const { name, adminEmail } = req.body;
  const org = await Organization.createOrganization(name.trim(), {}, 'client');
  if (adminEmail && String(adminEmail).trim()) {
    const existing = await User.findUserByEmail(adminEmail);
    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
    await Invite.createInvite({
      email: adminEmail,
      token,
      organizationId: org.id,
      expiresAt,
      invitedRole: 'admin',
    });
    return res.status(201).json({
      organization: org,
      inviteUrl: `/invite/${token}`,
    });
  }
  res.status(201).json({ organization: org });
});

router.patch('/organizations/:id', async (req, res) => {
  const { name, settings } = req.body;
  if (name === undefined && settings === undefined) {
    return res.status(400).json({ error: 'Nothing to update' });
  }
  const updated = await Organization.updateOrganizationClient(req.params.id, { name, settings });
  if (!updated) return res.status(404).json({ error: 'Organization not found' });
  res.json(updated);
});

router.get('/organizations/:id/users', async (req, res) => {
  const org = await Organization.getOrganization(req.params.id);
  if (!org || org.kind !== 'client') {
    return res.status(404).json({ error: 'Organization not found' });
  }
  const role = req.query.role;
  const users = await User.listUsersForOrg(req.params.id, {
    role: role === 'admin' || role === 'employee' ? role : undefined,
  });
  res.json({ users });
});

router.post('/organizations/:id/invites', requireBodyFields(['email']), async (req, res) => {
  const org = await Organization.getOrganization(req.params.id);
  if (!org || org.kind !== 'client') {
    return res.status(404).json({ error: 'Organization not found' });
  }
  const invitedRole = req.body.invitedRole === 'admin' ? 'admin' : 'employee';
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
    organizationId: org.id,
    expiresAt,
    invitedRole,
  });
  res.status(201).json({
    invite: {
      id: invite.id,
      email: invite.email,
      expiresAt: invite.expires_at,
      invitedRole: invite.invited_role,
    },
    inviteUrl: `/invite/${invite.token}`,
  });
});

router.get('/staff', async (req, res) => {
  const users = await User.listUsersForOrg(req.user.organizationId, {});
  res.json({ users: users.map(publicStaffUser) });
});

router.get('/users/:userId/avatar', async (req, res) => {
  const target = await User.findUserById(req.params.userId);
  if (!target || target.organization_id !== req.user.organizationId) {
    return res.status(404).end();
  }
  const name = await User.getProfileAvatarFilename(req.params.userId);
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
  res.setHeader('Content-Type', platformAvatarContentType(safeName));
  res.setHeader('Cache-Control', 'private, no-cache');
  res.sendFile(full);
});

router.post(
  '/users',
  (req, res, next) => {
    platformUserCreateUpload(req, res, (err) => {
      if (err) {
        const msg =
          err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 2MB or smaller' : err.message;
        return res.status(400).json({ error: msg || 'Upload failed' });
      }
      next();
    });
  },
  async (req, res) => {
    const firstName = req.body.firstName ?? '';
    const lastName = req.body.lastName ?? '';
    const email = req.body.email;
    const password = req.body.password;
    const role = req.body.role === 'employee' ? 'employee' : 'admin';
    if (!email || String(email).trim() === '') {
      return res.status(400).json({ error: 'Email is required' });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const existing = await User.findUserByEmail(String(email));
    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }
    const hash = await bcrypt.hash(String(password), 12);
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
        fs.writeFileSync(avatarFilePath(base), req.file.buffer);
        await User.setProfileAvatarFilename(row.id, base);
        outRow = await User.findUserById(row.id);
      } catch (e) {
        console.error(e);
      }
    }
    res.status(201).json({ user: publicStaffUser(outRow) });
  }
);

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
  });
  res.status(201).json({
    invite: {
      id: invite.id,
      email: invite.email,
      expiresAt: invite.expires_at,
    },
    inviteUrl: `/invite/${invite.token}`,
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

export default router;
