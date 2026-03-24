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
import { avatarFilePath, ensureStorageDirs, orgLogoFilePath } from '../config/storage.js';
import * as Organization from '../models/Organization.js';
import * as User from '../models/User.js';
import * as Invite from '../models/Invite.js';
import * as ClientWorkTask from '../models/ClientWorkTask.js';
import * as PulseSession from '../models/PulseSession.js';

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

const orgLogoPlatformUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (extensionForUpload(file)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, GIF, or WebP are allowed'));
  },
}).single('logo');

router.get('/organizations', async (_req, res) => {
  const rows = await Organization.listOrganizationsByKind('client');
  res.json({ organizations: rows });
});

router.post('/organizations', (req, res, next) => {
  orgLogoPlatformUpload(req, res, (err) => {
    if (err) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 2MB or smaller' : err.message;
      return res.status(400).json({ error: msg || 'Upload failed' });
    }
    next();
  });
}, async (req, res) => {
  const name = req.body.name;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  const adminEmail = req.body.adminEmail;
  let org = await Organization.createOrganization(name.trim(), {}, 'client');
  if (req.file) {
    const ext = extensionForUpload(req.file);
    const base = `org-${org.id}${ext || '.png'}`;
    try {
      fs.writeFileSync(orgLogoFilePath(base), req.file.buffer);
      const updated = await Organization.setCompanyLogoFilename(org.id, base);
      if (updated) org = updated;
    } catch (e) {
      console.error(e);
    }
  }
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

async function assertClientOrganizationPlatform(id) {
  const org = await Organization.getOrganization(id);
  if (!org || org.kind !== 'client') return null;
  return org;
}

function publicClientTask(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? '',
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByEmail: row.created_by_email ?? null,
  };
}

function publicPulseSessionRow(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

router.get('/organizations/:id', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  res.json({ organization: org });
});

router.get('/organizations/:id/logo', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org || !org.company_logo_filename) return res.status(404).end();
  const safeName = path.basename(org.company_logo_filename);
  const full = path.resolve(orgLogoFilePath(safeName));
  const { orgLogosDir } = ensureStorageDirs();
  const root = path.resolve(orgLogosDir);
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
  '/organizations/:id/logo',
  (req, res, next) => {
    orgLogoPlatformUpload(req, res, (err) => {
      if (err) {
        const msg =
          err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 2MB or smaller' : err.message;
        return res.status(400).json({ error: msg || 'Upload failed' });
      }
      next();
    });
  },
  async (req, res) => {
    const org = await assertClientOrganizationPlatform(req.params.id);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const ext = extensionForUpload(req.file);
    const base = `org-${org.id}${ext || '.png'}`;
    try {
      if (org.company_logo_filename && org.company_logo_filename !== base) {
        try {
          fs.unlinkSync(orgLogoFilePath(org.company_logo_filename));
        } catch {
          /* ignore */
        }
      }
      fs.writeFileSync(orgLogoFilePath(base), req.file.buffer);
      const updated = await Organization.setCompanyLogoFilename(org.id, base);
      res.json({ organization: updated });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Could not save logo' });
    }
  }
);

router.delete('/organizations/:id/logo', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const prev = await Organization.clearCompanyLogoFilename(req.params.id);
  if (prev) {
    try {
      fs.unlinkSync(orgLogoFilePath(prev));
    } catch {
      /* ignore */
    }
  }
  const updated = await Organization.getOrganization(req.params.id);
  res.json({ organization: updated });
});

router.get('/organizations/:id/pulse-sessions', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const sessions = await PulseSession.listSessionsForOrg(req.params.id);
  res.json({ sessions: sessions.map(publicPulseSessionRow) });
});

router.get('/organizations/:id/tasks', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const rows = await ClientWorkTask.listTasksForClientOrg(req.params.id);
  res.json({ tasks: rows.map(publicClientTask) });
});

router.post('/organizations/:id/tasks', requireBodyFields(['title']), async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const row = await ClientWorkTask.createTask(
    req.params.id,
    { title: req.body.title, body: req.body.body },
    req.user.id
  );
  if (!row) return res.status(400).json({ error: 'Invalid task' });
  res.status(201).json({ task: publicClientTask(row) });
});

router.patch('/organizations/:id/tasks/:taskId', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const body = req.body || {};
  const patch = {};
  if ('title' in body) patch.title = body.title;
  if ('body' in body) patch.body = body.body;
  if ('status' in body) patch.status = body.status;
  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: 'Nothing to update' });
  }
  const row = await ClientWorkTask.updateTaskForOrg(req.params.taskId, req.params.id, patch);
  if (!row) return res.status(404).json({ error: 'Task not found' });
  res.json({ task: publicClientTask(row) });
});

router.delete('/organizations/:id/tasks/:taskId', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const ok = await ClientWorkTask.deleteTaskForOrg(req.params.taskId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Task not found' });
  res.json({ ok: true });
});

router.get('/staff', async (req, res) => {
  const users = await User.listUsersForOrg(req.user.organizationId, {});
  res.json({ users: users.map(publicStaffUser) });
});

router.get('/users/:userId/avatar', async (req, res) => {
  const target = await User.findUserById(req.params.userId);
  if (!target || target.deactivated_at || target.organization_id !== req.user.organizationId) {
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

router.post(
  '/users/:userId/avatar',
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
          fs.unlinkSync(avatarFilePath(prev));
        } catch {
          /* ignore */
        }
      }
      fs.writeFileSync(avatarFilePath(base), req.file.buffer);
      await User.setProfileAvatarFilename(userId, base);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Could not save image' });
    }
    const outRow = await User.findUserById(userId);
    res.json({ user: publicStaffUser(outRow) });
  }
);

router.delete('/users/:userId/avatar', async (req, res) => {
  const { userId } = req.params;
  const target = await User.findUserById(userId);
  if (!target || target.deactivated_at || target.organization_id !== req.user.organizationId) {
    return res.status(404).json({ error: 'User not found' });
  }
  const prev = await User.clearProfileAvatarFilename(userId);
  if (prev) {
    try {
      fs.unlinkSync(avatarFilePath(prev));
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
