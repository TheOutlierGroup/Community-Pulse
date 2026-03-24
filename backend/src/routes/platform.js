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
import {
  avatarFilePath,
  ensureStorageDirs,
  orgLogoFilePath,
  taskImageFilePath,
} from '../config/storage.js';
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

const taskImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (extensionForUpload(file)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, GIF, or WebP are allowed'));
  },
}).single('image');

router.get('/organizations', async (_req, res) => {
  const rows = await Organization.listOrganizationsByKind('client');
  res.json({ organizations: rows });
});

/** Logged-in platform user's tasks across client orgs (assignee = self). */
router.get('/me/tasks-dashboard', async (req, res) => {
  const weekStart = req.query.weekStart;
  const weekEnd = req.query.weekEnd;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekStart || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(weekEnd || ''))) {
    return res.status(400).json({ error: 'Query weekStart and weekEnd are required (YYYY-MM-DD)' });
  }
  if (weekStart > weekEnd) {
    return res.status(400).json({ error: 'weekStart must be on or before weekEnd' });
  }
  const userId = req.user.id;
  const dueRows = await ClientWorkTask.listTasksDueBetweenForAssignee(userId, weekStart, weekEnd);
  const openCount = await ClientWorkTask.countOpenTasksAssignedToUserAcrossClientOrgs(userId);
  const myRows = await ClientWorkTask.listTasksAssignedToUserAcrossClientOrgs(userId);
  res.json({
    weekRange: { start: weekStart, end: weekEnd },
    tasksDueThisWeekCount: dueRows.length,
    openAssignedCount: openCount,
    tasksDueThisWeek: dueRows.map(publicStaffAssignedTask),
    myTasks: myRows.map(publicStaffAssignedTask),
  });
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
  const addrRaw = req.body.companyAddress ?? req.body.address;
  const initialSettings = {};
  if (addrRaw != null && String(addrRaw).trim()) {
    initialSettings.companyAddress = String(addrRaw).trim();
  }
  let org = await Organization.createOrganization(name.trim(), initialSettings, 'client');
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
  res.json({ users: users.map(publicStaffUser) });
});

async function assertClientUserInOrg(orgId, userId) {
  const org = await assertClientOrganizationPlatform(orgId);
  if (!org) return null;
  const target = await User.findUserById(userId);
  if (
    !target ||
    target.deactivated_at ||
    String(target.organization_id) !== String(org.id)
  ) {
    return null;
  }
  return target;
}

router.patch('/organizations/:id/users/:userId', async (req, res) => {
  const orgId = req.params.id;
  const { userId } = req.params;
  const target = await assertClientUserInOrg(orgId, userId);
  if (!target) return res.status(404).json({ error: 'User not found' });
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
    if (ex && String(ex.id) !== String(userId)) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }
    patch.email = em;
  }
  const row = await User.updateStaffUserInOrg(userId, orgId, patch);
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicStaffUser(row) });
});

router.get('/organizations/:id/users/:userId/avatar', async (req, res) => {
  const orgId = req.params.id;
  const { userId } = req.params;
  const target = await assertClientUserInOrg(orgId, userId);
  if (!target) return res.status(404).end();
  const name = await User.getProfileAvatarFilename(userId);
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
  '/organizations/:id/users/:userId/avatar',
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
    const orgId = req.params.id;
    const { userId } = req.params;
    const target = await assertClientUserInOrg(orgId, userId);
    if (!target) return res.status(404).json({ error: 'User not found' });
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

router.delete('/organizations/:id/users/:userId/avatar', async (req, res) => {
  const orgId = req.params.id;
  const { userId } = req.params;
  const target = await assertClientUserInOrg(orgId, userId);
  if (!target) return res.status(404).json({ error: 'User not found' });
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

function formatIsoDate(d) {
  if (d == null) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function publicAssignee(row) {
  if (!row.assignee_id) return null;
  return {
    id: row.assignee_id,
    email: row.assignee_email,
    firstName: row.assignee_first_name ?? '',
    lastName: row.assignee_last_name ?? '',
    organizationKind: row.assignee_org_kind,
  };
}

function publicClientTask(row) {
  let tagged = row.tagged_users_json;
  if (typeof tagged === 'string') {
    try {
      tagged = JSON.parse(tagged);
    } catch {
      tagged = [];
    }
  }
  if (!Array.isArray(tagged)) tagged = [];
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? '',
    notes: row.body ?? '',
    status: row.status,
    position: row.position ?? 0,
    startDate: formatIsoDate(row.start_date),
    dueDate: formatIsoDate(row.due_date),
    assignedTo: publicAssignee(row),
    taggedUsers: tagged.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName ?? '',
      lastName: u.lastName ?? '',
      organizationKind: u.organizationKind,
    })),
    imageCount: row.image_count ?? 0,
    commentCount: row.comment_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByEmail: row.created_by_email ?? null,
  };
}

function publicDashboardDueTask(row) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    dueDate: formatIsoDate(row.due_date),
    assignedTo:
      row.assignee_id != null
        ? {
            id: row.assignee_id,
            email: row.assignee_email,
            firstName: row.assignee_first_name ?? '',
            lastName: row.assignee_last_name ?? '',
          }
        : null,
  };
}

function publicStaffAssignedTask(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    title: row.title,
    status: row.status,
    dueDate: formatIsoDate(row.due_date),
    startDate: formatIsoDate(row.start_date),
  };
}

async function assertAssignableUserIds(clientOrgId, userIds) {
  if (!userIds?.length) return true;
  const allow = await User.listAssignableUsersForClientTasks(clientOrgId);
  const set = new Set(allow.map((u) => String(u.id)));
  return userIds.every((id) => set.has(String(id)));
}

function publicAssignableUser(row) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    role: row.role,
    organizationKind: row.organization_kind,
    hasProfileAvatar: Boolean(row.profile_avatar_filename),
  };
}

async function buildTaskDetail(orgId, taskId) {
  const row = await ClientWorkTask.getTaskListRow(taskId, orgId);
  if (!row) return null;
  const base = publicClientTask(row);
  const imgs = await ClientWorkTask.listTaskImages(taskId, orgId);
  const comments = await ClientWorkTask.listCommentsForTask(taskId, orgId);
  const cids = comments.map((c) => c.id);
  const mentions = await ClientWorkTask.listCommentMentions(cids);
  const cImages = await ClientWorkTask.listCommentImagesForTask(taskId, orgId);
  const mentionByComment = {};
  for (const m of mentions) {
    if (!mentionByComment[m.comment_id]) mentionByComment[m.comment_id] = [];
    mentionByComment[m.comment_id].push({
      userId: m.user_id,
      email: m.email,
      firstName: m.first_name ?? '',
      lastName: m.last_name ?? '',
      organizationKind: m.organization_kind,
    });
  }
  const imagesByComment = {};
  for (const im of cImages) {
    if (!imagesByComment[im.comment_id]) imagesByComment[im.comment_id] = [];
    imagesByComment[im.comment_id].push({
      id: im.id,
      createdAt: im.created_at,
    });
  }
  const publicComments = comments.map((c) => ({
    id: c.id,
    body: c.body,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    author: c.author_id
      ? {
          id: c.author_id,
          email: c.author_email,
          firstName: c.author_first_name ?? '',
          lastName: c.author_last_name ?? '',
          organizationKind: c.author_org_kind,
        }
      : null,
    mentions: mentionByComment[c.id] || [],
    images: imagesByComment[c.id] || [],
  }));
  return {
    ...base,
    images: imgs.map((i) => ({
      id: i.id,
      sortOrder: i.sort_order,
      createdAt: i.created_at,
    })),
    comments: publicComments,
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

router.get('/organizations/:id/dashboard', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const weekStart = req.query.weekStart;
  const weekEnd = req.query.weekEnd;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekStart || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(weekEnd || ''))) {
    return res.status(400).json({ error: 'Query weekStart and weekEnd are required (YYYY-MM-DD)' });
  }
  if (weekStart > weekEnd) {
    return res.status(400).json({ error: 'weekStart must be on or before weekEnd' });
  }
  const userCount = await User.countActiveUsersForClientOrg(req.params.id);
  const taskCountsByStatus = await ClientWorkTask.countTasksByStatusForOrg(req.params.id);
  const dueRows = await ClientWorkTask.listTasksDueBetween(req.params.id, weekStart, weekEnd);
  const totalTasks = Object.values(taskCountsByStatus).reduce((a, b) => a + b, 0);
  res.json({
    userCount,
    totalTasks,
    taskCountsByStatus,
    weekRange: { start: weekStart, end: weekEnd },
    tasksDueThisWeek: dueRows.map(publicDashboardDueTask),
  });
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

router.get('/organizations/:id/tasks/assignable-users', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const rows = await User.listAssignableUsersForClientTasks(req.params.id);
  res.json({ users: rows.map(publicAssignableUser) });
});

router.post('/organizations/:id/tasks', requireBodyFields(['title']), async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const b = req.body || {};
  const tagged = Array.isArray(b.taggedUserIds) ? b.taggedUserIds : [];
  if (!(await assertAssignableUserIds(req.params.id, tagged))) {
    return res.status(400).json({ error: 'Invalid tagged users' });
  }
  if (b.assignedTo && !(await assertAssignableUserIds(req.params.id, [b.assignedTo]))) {
    return res.status(400).json({ error: 'Invalid assignee' });
  }
  const row = await ClientWorkTask.createTask(
    req.params.id,
    {
      title: b.title,
      body: b.body,
      notes: b.notes,
      startDate: b.startDate,
      dueDate: b.dueDate,
      assignedTo: b.assignedTo || null,
      taggedUserIds: tagged,
    },
    req.user.id
  );
  if (!row) return res.status(400).json({ error: 'Invalid task' });
  const detail = await buildTaskDetail(req.params.id, row.id);
  res.status(201).json({ task: detail || publicClientTask(row) });
});

router.patch('/organizations/:id/tasks/reorder', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const body = req.body || {};
  const tasks = body.tasks;
  if (!Array.isArray(tasks)) {
    return res.status(400).json({ error: 'tasks must be an array' });
  }
  const ok = await ClientWorkTask.reorderTasksForOrg(req.params.id, tasks);
  if (!ok) return res.status(400).json({ error: 'Invalid reorder payload' });
  const rows = await ClientWorkTask.listTasksForClientOrg(req.params.id);
  res.json({ tasks: rows.map(publicClientTask) });
});

router.get('/organizations/:id/tasks/:taskId', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const detail = await buildTaskDetail(req.params.id, req.params.taskId);
  if (!detail) return res.status(404).json({ error: 'Task not found' });
  res.json({ task: detail });
});

router.patch('/organizations/:id/tasks/:taskId', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const body = req.body || {};
  const tagged = body.taggedUserIds;
  if (Array.isArray(tagged) && !(await assertAssignableUserIds(req.params.id, tagged))) {
    return res.status(400).json({ error: 'Invalid tagged users' });
  }
  if (body.assignedTo && !(await assertAssignableUserIds(req.params.id, [body.assignedTo]))) {
    return res.status(400).json({ error: 'Invalid assignee' });
  }
  if (
    Object.prototype.hasOwnProperty.call(body, 'assignedTo') &&
    (body.assignedTo === null || body.assignedTo === '')
  ) {
    body.assignedTo = null;
  }
  const patch = {};
  if ('title' in body) patch.title = body.title;
  if ('body' in body) patch.body = body.body;
  if ('notes' in body) patch.notes = body.notes;
  if ('status' in body) patch.status = body.status;
  if ('position' in body) patch.position = body.position;
  if ('startDate' in body) patch.startDate = body.startDate;
  if ('dueDate' in body) patch.dueDate = body.dueDate;
  if ('assignedTo' in body) patch.assignedTo = body.assignedTo;
  if ('taggedUserIds' in body) patch.taggedUserIds = body.taggedUserIds;
  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: 'Nothing to update' });
  }
  const row = await ClientWorkTask.updateTaskForOrg(req.params.taskId, req.params.id, patch);
  if (!row) return res.status(404).json({ error: 'Task not found' });
  const detail = await buildTaskDetail(req.params.id, req.params.taskId);
  res.json({ task: detail || publicClientTask(row) });
});

router.post(
  '/organizations/:id/tasks/:taskId/images',
  (req, res, next) => {
    taskImageUpload(req, res, (err) => {
      if (err) {
        const msg =
          err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5MB or smaller' : err.message;
        return res.status(400).json({ error: msg || 'Upload failed' });
      }
      next();
    });
  },
  async (req, res) => {
    const org = await assertClientOrganizationPlatform(req.params.id);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const ext = extensionForUpload(req.file);
    const base = ClientWorkTask.newTaskImageFilename(req.params.taskId, ext || '.png');
    try {
      fs.writeFileSync(taskImageFilePath(base), req.file.buffer);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Could not save image' });
    }
    const img = await ClientWorkTask.addTaskImage(
      req.params.taskId,
      req.params.id,
      base,
      req.user.id
    );
    if (!img) {
      try {
        fs.unlinkSync(taskImageFilePath(base));
      } catch {
        /* ignore */
      }
      return res.status(404).json({ error: 'Task not found' });
    }
    res.status(201).json({
      image: {
        id: img.id,
        sortOrder: img.sort_order,
        createdAt: img.created_at,
      },
    });
  }
);

router.get('/organizations/:id/tasks/:taskId/images/:imageId/file', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).end();
  const row = await ClientWorkTask.getTaskImageForOrg(
    req.params.imageId,
    req.params.taskId,
    req.params.id
  );
  if (!row) return res.status(404).end();
  const safeName = path.basename(row.stored_filename);
  const full = path.resolve(taskImageFilePath(safeName));
  const { taskImagesDir } = ensureStorageDirs();
  const root = path.resolve(taskImagesDir);
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return res.status(403).end();
  }
  if (!fs.existsSync(full)) return res.status(404).end();
  res.setHeader('Content-Type', platformAvatarContentType(safeName));
  res.setHeader('Cache-Control', 'private, no-cache');
  res.sendFile(full);
});

router.delete('/organizations/:id/tasks/:taskId/images/:imageId', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const prev = await ClientWorkTask.deleteTaskImage(
    req.params.imageId,
    req.params.taskId,
    req.params.id
  );
  if (!prev) return res.status(404).json({ error: 'Image not found' });
  try {
    fs.unlinkSync(taskImageFilePath(prev));
  } catch {
    /* ignore */
  }
  res.json({ ok: true });
});

router.post('/organizations/:id/tasks/:taskId/comments', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const body = req.body || {};
  const mentionIds = Array.isArray(body.mentionUserIds) ? body.mentionUserIds : [];
  if (!(await assertAssignableUserIds(req.params.id, mentionIds))) {
    return res.status(400).json({ error: 'Invalid mentions' });
  }
  const commentId = await ClientWorkTask.createComment(
    req.params.taskId,
    req.params.id,
    req.user.id,
    body.body ?? '',
    mentionIds
  );
  if (!commentId) return res.status(404).json({ error: 'Task not found' });
  const detail = await buildTaskDetail(req.params.id, req.params.taskId);
  res.status(201).json({ comment: { id: commentId }, task: detail });
});

router.post(
  '/organizations/:id/tasks/:taskId/comments/:commentId/images',
  (req, res, next) => {
    taskImageUpload(req, res, (err) => {
      if (err) {
        const msg =
          err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5MB or smaller' : err.message;
        return res.status(400).json({ error: msg || 'Upload failed' });
      }
      next();
    });
  },
  async (req, res) => {
    const org = await assertClientOrganizationPlatform(req.params.id);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const ext = extensionForUpload(req.file);
    const base = ClientWorkTask.newCommentImageFilename(req.params.commentId, ext || '.png');
    try {
      fs.writeFileSync(taskImageFilePath(base), req.file.buffer);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Could not save image' });
    }
    const img = await ClientWorkTask.addCommentImage(
      req.params.commentId,
      req.params.taskId,
      req.params.id,
      base
    );
    if (!img) {
      try {
        fs.unlinkSync(taskImageFilePath(base));
      } catch {
        /* ignore */
      }
      return res.status(404).json({ error: 'Comment not found' });
    }
    const detail = await buildTaskDetail(req.params.id, req.params.taskId);
    res.status(201).json({ task: detail });
  }
);

router.get(
  '/organizations/:id/tasks/:taskId/comments/:commentId/images/:imageId/file',
  async (req, res) => {
    const org = await assertClientOrganizationPlatform(req.params.id);
    if (!org) return res.status(404).end();
    const row = await ClientWorkTask.getCommentImageForOrg(
      req.params.imageId,
      req.params.commentId,
      req.params.taskId,
      req.params.id
    );
    if (!row) return res.status(404).end();
    const safeName = path.basename(row.stored_filename);
    const full = path.resolve(taskImageFilePath(safeName));
    const { taskImagesDir } = ensureStorageDirs();
    const root = path.resolve(taskImagesDir);
    const rel = path.relative(root, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return res.status(403).end();
    }
    if (!fs.existsSync(full)) return res.status(404).end();
    res.setHeader('Content-Type', platformAvatarContentType(safeName));
    res.setHeader('Cache-Control', 'private, no-cache');
    res.sendFile(full);
  }
);

router.delete('/organizations/:id/tasks/:taskId/comments/:commentId/images/:imageId', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const prev = await ClientWorkTask.deleteCommentImage(
    req.params.imageId,
    req.params.commentId,
    req.params.taskId,
    req.params.id
  );
  if (!prev) return res.status(404).json({ error: 'Image not found' });
  try {
    fs.unlinkSync(taskImageFilePath(prev));
  } catch {
    /* ignore */
  }
  const detail = await buildTaskDetail(req.params.id, req.params.taskId);
  res.json({ task: detail });
});

router.delete('/organizations/:id/tasks/:taskId', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const images = await ClientWorkTask.listTaskImages(req.params.taskId, req.params.id);
  const cImages = await ClientWorkTask.listCommentImagesForTask(req.params.taskId, req.params.id);
  const ok = await ClientWorkTask.deleteTaskForOrg(req.params.taskId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Task not found' });
  for (const im of [...images, ...cImages]) {
    try {
      fs.unlinkSync(taskImageFilePath(im.stored_filename));
    } catch {
      /* ignore */
    }
  }
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
