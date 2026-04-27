import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { Router } from 'express';
import multer from 'multer';
import { requireBodyFields } from '../../middleware/validation.js';
import { ensureStorageDirs, taskImageFilePath } from '../../config/storage.js';
import * as User from '../../models/User.js';
import * as ClientWorkTask from '../../models/ClientWorkTask.js';
import * as Organization from '../../models/Organization.js';
import * as taskNotificationTriggers from '../../services/taskNotificationTriggers.js';
import { assertClientOrganizationPlatformForUser } from './shared.js';

const router = Router();

const TASK_ATTACHMENT_MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/csv': '.csv',
  'application/csv': '.csv',
};

const TASK_ATTACHMENT_ALLOWED_EXT = new Set(Object.values(TASK_ATTACHMENT_MIME_TO_EXT));

function extensionForTaskAttachmentUpload(file) {
  const ext = path.extname(String(file?.originalname || '')).toLowerCase();
  if (TASK_ATTACHMENT_ALLOWED_EXT.has(ext)) return ext;
  const mime = String(file?.mimetype || '').toLowerCase();
  return TASK_ATTACHMENT_MIME_TO_EXT[mime] || null;
}

function taskAttachmentContentType(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.csv': 'text/csv',
  };
  return map[ext] || 'application/octet-stream';
}

function isImageAttachmentFilename(filename) {
  const contentType = taskAttachmentContentType(filename);
  return contentType.startsWith('image/');
}

async function runOfficePdfConversion(inputPath, outputDir) {
  const args = ['--headless', '--convert-to', 'pdf:writer_pdf_Export', '--outdir', outputDir, inputPath];
  const candidates = ['soffice', 'libreoffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'];
  let lastFailure = null;
  for (const bin of candidates) {
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(bin, args, { stdio: 'ignore' });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`converter exited with code ${code}`));
        });
      });
      return;
    } catch (err) {
      const isMissingBinary = err && (err.code === 'ENOENT' || err.code === 'ENOTDIR');
      if (isMissingBinary) {
        lastFailure = err;
        continue;
      }
      throw err;
    }
  }
  const unavailable = new Error('office converter unavailable');
  unavailable.code = 'PREVIEW_CONVERSION_UNAVAILABLE';
  unavailable.cause = lastFailure;
  throw unavailable;
}

async function convertDocAttachmentToPdfBuffer(fullPath, safeName) {
  const ext = path.extname(safeName).toLowerCase();
  if (ext !== '.doc') {
    const unsupported = new Error('conversion unsupported');
    unsupported.code = 'PREVIEW_CONVERSION_UNSUPPORTED';
    throw unsupported;
  }

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'task-attachment-preview-'));
  const inputFile = path.join(tmpDir, `source${ext}`);
  const outputFile = path.join(tmpDir, 'source.pdf');
  try {
    await fs.promises.copyFile(fullPath, inputFile);
    await runOfficePdfConversion(inputFile, tmpDir);
    return await fs.promises.readFile(outputFile);
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

async function maybeSendConvertedPreview(req, res, fullPath, safeName) {
  const wantsPdfPreview = String(req.query?.preview || '').toLowerCase() === 'pdf';
  if (!wantsPdfPreview) return false;
  try {
    const pdfBuffer = await convertDocAttachmentToPdfBuffer(fullPath, safeName);
    const baseName = path.parse(safeName).name || 'attachment';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${baseName}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.send(pdfBuffer);
    return true;
  } catch (err) {
    if (err?.code === 'PREVIEW_CONVERSION_UNSUPPORTED') return false;
    if (err?.code === 'PREVIEW_CONVERSION_UNAVAILABLE') {
      res.status(501).json({ error: 'Preview conversion not available on this server' });
      return true;
    }
    console.error(err);
    res.status(422).json({ error: 'Could not convert attachment for preview' });
    return true;
  }
}

async function assertClientOrganizationPlatform(id) {
  const org = await Organization.getOrganization(id);
  if (!org) return null;
  return org.kind === 'client' || org.kind === 'platform' ? org : null;
}

router.use('/organizations/:id', async (req, res, next) => {
  try {
    const requestedId = String(req.params.id || '').trim();
    const ownOrgId = String(req.user?.organizationId || '').trim();
    const canAccessOwnPlatformOrg = requestedId && ownOrgId && requestedId === ownOrgId;
    const org = canAccessOwnPlatformOrg
      ? await assertClientOrganizationPlatform(requestedId)
      : await assertClientOrganizationPlatformForUser(requestedId, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    req.clientOrganization = org;
    next();
  } catch (err) {
    next(err);
  }
});

const taskImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (extensionForTaskAttachmentUpload(file)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, GIF, WebP, PDF, DOC, DOCX, XLS, XLSX, or CSV files are allowed'));
  },
}).single('image');

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

function publicCreatedBy(row) {
  if (!row.created_by) return null;
  return {
    id: row.created_by,
    email: row.created_by_email ?? '',
    firstName: row.created_by_first_name ?? '',
    lastName: row.created_by_last_name ?? '',
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
  let labels = row.labels_json;
  if (typeof labels === 'string') {
    try {
      labels = JSON.parse(labels);
    } catch {
      labels = [];
    }
  }
  if (!Array.isArray(labels)) labels = [];
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
    labels: labels.map((lb) => ({
      id: lb.id,
      name: lb.name ?? '',
    })),
    imageCount: row.image_count ?? 0,
    commentCount: row.comment_count ?? 0,
    checklistItemCount: row.checklist_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: publicCreatedBy(row),
    createdByEmail: row.created_by_email ?? null,
  };
}

function publicTaskActivity(row) {
  let payload = row.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) payload = {};
  return {
    id: row.id,
    type: row.activity_type,
    payload,
    createdAt: row.created_at,
    actor: row.actor_id
      ? {
          id: row.actor_id,
          email: row.actor_email,
          firstName: row.actor_first_name ?? '',
          lastName: row.actor_last_name ?? '',
          organizationKind: row.actor_org_kind,
        }
      : null,
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

function assigneeLabelFromTaskRow(row) {
  if (!row?.assignee_id) return null;
  const first = String(row.assignee_first_name || '').trim();
  const last = String(row.assignee_last_name || '').trim();
  const full = [first, last].filter(Boolean).join(' ').trim();
  return full || String(row.assignee_email || '').trim() || null;
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

function parsePagination(query) {
  const rawLimit = Number.parseInt(String(query?.limit ?? ''), 10);
  const rawOffset = Number.parseInt(String(query?.offset ?? ''), 10);
  return {
    limit: Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : 500,
    offset: Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0,
  };
}

async function buildTaskDetail(orgId, taskId, viewerUserId = null) {
  const row = await ClientWorkTask.getTaskListRow(taskId, orgId);
  if (!row) return null;
  const base = publicClientTask(row);
  const [watching, imgs, comments, cImages, checklistRows, activityRows] = await Promise.all([
    viewerUserId
      ? ClientWorkTask.isUserWatchingTask(taskId, orgId, viewerUserId)
      : Promise.resolve(false),
    ClientWorkTask.listTaskImages(taskId, orgId),
    ClientWorkTask.listCommentsForTask(taskId, orgId),
    ClientWorkTask.listCommentImagesForTask(taskId, orgId),
    ClientWorkTask.listChecklistItemsForTask(taskId, orgId),
    ClientWorkTask.listTaskActivityForTask(taskId, orgId),
  ]);
  const cids = comments.map((c) => c.id);
  const mentions = await ClientWorkTask.listCommentMentions(cids);
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
      isImage: isImageAttachmentFilename(im.stored_filename),
      canDelete: Boolean(
        viewerUserId &&
        im.comment_author_id &&
        String(im.comment_author_id) === String(viewerUserId)
      ),
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
  const checklistItems = checklistRows.map((r) => ({
    id: r.id,
    text: r.body,
    done: r.done,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  }));
  return {
    ...base,
    watching,
    images: imgs.map((i) => ({
      id: i.id,
      sortOrder: i.sort_order,
      createdAt: i.created_at,
      isImage: isImageAttachmentFilename(i.stored_filename),
      canDelete: Boolean(
        viewerUserId &&
        i.created_by &&
        String(i.created_by) === String(viewerUserId)
      ),
    })),
    comments: publicComments,
    checklistItems,
    activities: activityRows.map(publicTaskActivity),
  };
}

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
  const [userCount, taskCountsByStatus, dueRows] = await Promise.all([
    User.countActiveUsersForClientOrg(req.params.id),
    ClientWorkTask.countTasksByStatusForOrg(req.params.id),
    ClientWorkTask.listTasksDueBetween(req.params.id, weekStart, weekEnd),
  ]);
  const totalTasks = Object.values(taskCountsByStatus).reduce((a, b) => a + b, 0);
  res.json({
    userCount,
    totalTasks,
    taskCountsByStatus,
    weekRange: { start: weekStart, end: weekEnd },
    tasksDueThisWeek: dueRows.map(publicDashboardDueTask),
  });
});

router.get('/organizations/:id/tasks', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const page = parsePagination(req.query);
  const rows = await ClientWorkTask.listTasksForClientOrg(req.params.id, page);
  res.json({ tasks: rows.map(publicClientTask) });
});

router.get('/organizations/:id/tasks/assignable-users', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const rows = await User.listAssignableUsersForClientTasks(req.params.id);
  res.json({ users: rows.map(publicAssignableUser) });
});

router.get('/organizations/:id/tasks/label-suggestions', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const labels = await ClientWorkTask.listDistinctCardLabelNamesForOrg(req.params.id);
  res.json({ labels });
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
      status: b.status,
    },
    req.user.id
  );
  if (!row) return res.status(400).json({ error: 'Invalid task' });
  const detail = await buildTaskDetail(req.params.id, row.id, req.user.id);
  if (detail?.assignedTo?.id) {
    taskNotificationTriggers.scheduleNotifyTaskAssigned({
      organizationId: req.params.id,
      taskId: row.id,
      assigneeId: detail.assignedTo.id,
      actorId: req.user.id,
      taskTitle: detail.title,
    });
  }
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
  const ok = await ClientWorkTask.reorderTasksForOrg(req.params.id, tasks, req.user.id);
  if (!ok) return res.status(400).json({ error: 'Invalid reorder payload' });
  const rows = await ClientWorkTask.listTasksForClientOrg(req.params.id, { limit: 500, offset: 0 });
  res.json({ tasks: rows.map(publicClientTask) });
});

router.get('/organizations/:id/tasks/:taskId', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const detail = await buildTaskDetail(req.params.id, req.params.taskId, req.user.id);
  if (!detail) return res.status(404).json({ error: 'Task not found' });
  res.json({ task: detail });
});

router.post('/organizations/:id/tasks/:taskId/watch', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const task = await ClientWorkTask.getTaskForOrg(req.params.taskId, req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  await ClientWorkTask.addTaskWatcher(req.params.taskId, req.params.id, req.user.id);
  const detail = await buildTaskDetail(req.params.id, req.params.taskId, req.user.id);
  res.json({ task: detail });
});

router.delete('/organizations/:id/tasks/:taskId/watch', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const task = await ClientWorkTask.getTaskForOrg(req.params.taskId, req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  await ClientWorkTask.removeTaskWatcher(req.params.taskId, req.params.id, req.user.id);
  const detail = await buildTaskDetail(req.params.id, req.params.taskId, req.user.id);
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
  if ('labels' in body) {
    if (!Array.isArray(body.labels)) {
      return res.status(400).json({ error: 'labels must be an array of strings' });
    }
    patch.labels = body.labels;
  }
  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: 'Nothing to update' });
  }
  const beforeRow = await ClientWorkTask.getTaskListRow(req.params.taskId, req.params.id);
  if (!beforeRow) return res.status(404).json({ error: 'Task not found' });
  const row = await ClientWorkTask.updateTaskForOrg(req.params.taskId, req.params.id, patch, req.user.id);
  if (!row) return res.status(404).json({ error: 'Task not found' });
  const afterRow = await ClientWorkTask.getTaskListRow(req.params.taskId, req.params.id);

  const beforeAssignee = assigneeLabelFromTaskRow(beforeRow);
  const afterAssignee = assigneeLabelFromTaskRow(afterRow);
  if (beforeAssignee !== afterAssignee) {
    await ClientWorkTask.createTaskActivity(
      req.params.taskId,
      req.params.id,
      req.user.id,
      ClientWorkTask.TASK_ACTIVITY_ASSIGNEE_CHANGED,
      {
        fromAssignee: beforeAssignee,
        toAssignee: afterAssignee,
      }
    );
  }
  const beforeStartDate = formatIsoDate(beforeRow.start_date);
  const afterStartDate = formatIsoDate(afterRow.start_date);
  if (beforeStartDate !== afterStartDate) {
    await ClientWorkTask.createTaskActivity(
      req.params.taskId,
      req.params.id,
      req.user.id,
      ClientWorkTask.TASK_ACTIVITY_START_DATE_CHANGED,
      {
        fromDate: beforeStartDate,
        toDate: afterStartDate,
      }
    );
  }
  const beforeDueDate = formatIsoDate(beforeRow.due_date);
  const afterDueDate = formatIsoDate(afterRow.due_date);
  if (beforeDueDate !== afterDueDate) {
    await ClientWorkTask.createTaskActivity(
      req.params.taskId,
      req.params.id,
      req.user.id,
      ClientWorkTask.TASK_ACTIVITY_DUE_DATE_CHANGED,
      {
        fromDate: beforeDueDate,
        toDate: afterDueDate,
      }
    );
  }

  const oldA = beforeRow.assignee_id != null ? String(beforeRow.assignee_id) : null;
  const newA = afterRow.assignee_id != null ? String(afterRow.assignee_id) : null;
  if (newA !== oldA && newA) {
    taskNotificationTriggers.scheduleNotifyTaskAssigned({
      organizationId: req.params.id,
      taskId: req.params.taskId,
      assigneeId: newA,
      actorId: req.user.id,
      taskTitle: afterRow.title,
    });
  }

  const notifyKeys = new Set(['title', 'body', 'notes', 'status', 'startDate', 'dueDate', 'assignedTo']);
  const shouldNotifyWatchers = Object.keys(patch).some((k) => notifyKeys.has(k));
  if (shouldNotifyWatchers) {
    taskNotificationTriggers.scheduleNotifyTaskUpdatesForWatchers({
      organizationId: req.params.id,
      taskId: req.params.taskId,
      actorId: req.user.id,
      beforeRow,
      afterRow,
      taskTitle: afterRow.title,
    });
  }

  const detail = await buildTaskDetail(req.params.id, req.params.taskId, req.user.id);
  res.json({ task: detail || publicClientTask(row) });
});

router.post('/organizations/:id/tasks/:taskId/checklist-items', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const task = await ClientWorkTask.getTaskForOrg(req.params.taskId, req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const text = (req.body || {}).text;
  const row = await ClientWorkTask.addChecklistItem(req.params.taskId, req.params.id, text);
  if (!row) return res.status(400).json({ error: 'Checklist item text is required' });
  await ClientWorkTask.createTaskActivity(
    req.params.taskId,
    req.params.id,
    req.user.id,
    ClientWorkTask.TASK_ACTIVITY_CHECKLIST_ITEM_ADDED,
    { text: row.body }
  );
  const detail = await buildTaskDetail(req.params.id, req.params.taskId, req.user.id);
  res.status(201).json({ task: detail });
});

router.patch('/organizations/:id/tasks/:taskId/checklist-items/:itemId', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const task = await ClientWorkTask.getTaskForOrg(req.params.taskId, req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const body = req.body || {};
  const itemPatch = {};
  if ('text' in body) itemPatch.text = body.text;
  if ('done' in body) itemPatch.done = body.done;
  if (!Object.keys(itemPatch).length) {
    return res.status(400).json({ error: 'Nothing to update' });
  }
  const row = await ClientWorkTask.updateChecklistItemForOrg(
    req.params.itemId,
    req.params.taskId,
    req.params.id,
    itemPatch
  );
  if (!row) return res.status(400).json({ error: 'Could not update checklist item' });
  const detail = await buildTaskDetail(req.params.id, req.params.taskId, req.user.id);
  res.json({ task: detail });
});

router.delete('/organizations/:id/tasks/:taskId/checklist-items/:itemId', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const task = await ClientWorkTask.getTaskForOrg(req.params.taskId, req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const deleted = await ClientWorkTask.deleteChecklistItemForOrg(
    req.params.itemId,
    req.params.taskId,
    req.params.id
  );
  if (!deleted) return res.status(404).json({ error: 'Checklist item not found' });
  await ClientWorkTask.createTaskActivity(
    req.params.taskId,
    req.params.id,
    req.user.id,
    ClientWorkTask.TASK_ACTIVITY_CHECKLIST_ITEM_REMOVED,
    { text: deleted.body }
  );
  const detail = await buildTaskDetail(req.params.id, req.params.taskId, req.user.id);
  res.json({ task: detail });
});

router.post(
  '/organizations/:id/tasks/:taskId/images',
  (req, res, next) => {
    taskImageUpload(req, res, (err) => {
      if (err) {
        const msg =
          err.code === 'LIMIT_FILE_SIZE' ? 'File must be 5MB or smaller' : err.message;
        return res.status(400).json({ error: msg || 'Upload failed' });
      }
      next();
    });
  },
  async (req, res) => {
    const org = await assertClientOrganizationPlatform(req.params.id);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const ext = extensionForTaskAttachmentUpload(req.file);
    const base = ClientWorkTask.newTaskImageFilename(req.params.taskId, ext || '.png');
    try {
      await fs.promises.writeFile(taskImageFilePath(base), req.file.buffer);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Could not save file' });
    }
    const img = await ClientWorkTask.addTaskImage(
      req.params.taskId,
      req.params.id,
      base,
      req.user.id
    );
    if (!img) {
      try {
        await fs.promises.unlink(taskImageFilePath(base));
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
        isImage: isImageAttachmentFilename(img.stored_filename),
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
  if (await maybeSendConvertedPreview(req, res, full, safeName)) return;
  res.setHeader('Content-Type', taskAttachmentContentType(safeName));
  res.setHeader('Cache-Control', 'private, no-cache');
  res.sendFile(full);
});

router.delete('/organizations/:id/tasks/:taskId/images/:imageId', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const row = await ClientWorkTask.getTaskImageForOrg(
    req.params.imageId,
    req.params.taskId,
    req.params.id
  );
  if (!row) return res.status(404).json({ error: 'Image not found' });
  if (!row.created_by || String(row.created_by) !== String(req.user.id)) {
    return res.status(403).json({ error: 'Only the uploader can remove this attachment' });
  }
  const prev = await ClientWorkTask.deleteTaskImage(
    req.params.imageId,
    req.params.taskId,
    req.params.id
  );
  if (!prev) return res.status(404).json({ error: 'Image not found' });
  try {
    await fs.promises.unlink(taskImageFilePath(prev));
  } catch {
    /* ignore */
  }
  const detail = await buildTaskDetail(req.params.id, req.params.taskId, req.user.id);
  res.json({ task: detail });
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
  const taskRow = await ClientWorkTask.getTaskListRow(req.params.taskId, req.params.id);
  taskNotificationTriggers.scheduleNotifyNewComment({
    organizationId: req.params.id,
    taskId: req.params.taskId,
    commentId,
    authorId: req.user.id,
    mentionUserIds: mentionIds,
    taskTitle: taskRow?.title || 'Task',
  });
  const detail = await buildTaskDetail(req.params.id, req.params.taskId, req.user.id);
  res.status(201).json({ comment: { id: commentId }, task: detail });
});

router.post(
  '/organizations/:id/tasks/:taskId/comments/:commentId/images',
  (req, res, next) => {
    taskImageUpload(req, res, (err) => {
      if (err) {
        const msg =
          err.code === 'LIMIT_FILE_SIZE' ? 'File must be 5MB or smaller' : err.message;
        return res.status(400).json({ error: msg || 'Upload failed' });
      }
      next();
    });
  },
  async (req, res) => {
    const org = await assertClientOrganizationPlatform(req.params.id);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const ext = extensionForTaskAttachmentUpload(req.file);
    const base = ClientWorkTask.newCommentImageFilename(req.params.commentId, ext || '.png');
    try {
      await fs.promises.writeFile(taskImageFilePath(base), req.file.buffer);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Could not save file' });
    }
    const img = await ClientWorkTask.addCommentImage(
      req.params.commentId,
      req.params.taskId,
      req.params.id,
      base
    );
    if (!img) {
      try {
        await fs.promises.unlink(taskImageFilePath(base));
      } catch {
        /* ignore */
      }
      return res.status(404).json({ error: 'Comment not found' });
    }
    const detail = await buildTaskDetail(req.params.id, req.params.taskId, req.user.id);
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
    if (await maybeSendConvertedPreview(req, res, full, safeName)) return;
    res.setHeader('Content-Type', taskAttachmentContentType(safeName));
    res.setHeader('Cache-Control', 'private, no-cache');
    res.sendFile(full);
  }
);

router.delete('/organizations/:id/tasks/:taskId/comments/:commentId/images/:imageId', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const comment = await ClientWorkTask.getCommentForOrg(
    req.params.commentId,
    req.params.taskId,
    req.params.id
  );
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  if (!comment.author_id || String(comment.author_id) !== String(req.user.id)) {
    return res.status(403).json({ error: 'Only the comment author can remove this attachment' });
  }
  const prev = await ClientWorkTask.deleteCommentImage(
    req.params.imageId,
    req.params.commentId,
    req.params.taskId,
    req.params.id
  );
  if (!prev) return res.status(404).json({ error: 'Image not found' });
  try {
    await fs.promises.unlink(taskImageFilePath(prev));
  } catch {
    /* ignore */
  }
  const detail = await buildTaskDetail(req.params.id, req.params.taskId, req.user.id);
  res.json({ task: detail });
});

router.delete('/organizations/:id/tasks/:taskId', async (req, res) => {
  const org = await assertClientOrganizationPlatform(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  const images = await ClientWorkTask.listTaskImages(req.params.taskId, req.params.id);
  const cImages = await ClientWorkTask.listCommentImagesForTask(req.params.taskId, req.params.id);
  const ok = await ClientWorkTask.deleteTaskForOrg(req.params.taskId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Task not found' });
  await Promise.allSettled(
    [...images, ...cImages].map((im) => fs.promises.unlink(taskImageFilePath(im.stored_filename)))
  );
  res.json({ ok: true });
});

export default router;
