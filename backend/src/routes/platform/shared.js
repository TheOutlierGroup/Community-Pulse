import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { extensionForUpload } from '../../middleware/avatarUpload.js';
import { avatarFilePath, ensureStorageDirs, orgLogoFilePath } from '../../config/storage.js';
import * as Organization from '../../models/Organization.js';
import * as User from '../../models/User.js';
import { normalizeClientServiceIds } from '../../services/clientServices.js';

function platformUploadError(err, fileSizeMessage) {
  const msg = err.code === 'LIMIT_FILE_SIZE' ? fileSizeMessage : err.message;
  return msg || 'Upload failed';
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

export function handlePlatformUserCreateUpload(req, res, next) {
  platformUserCreateUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: platformUploadError(err, 'Image must be 2MB or smaller') });
    next();
  });
}

export function handleOrgLogoPlatformUpload(req, res, next) {
  orgLogoPlatformUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: platformUploadError(err, 'Image must be 2MB or smaller') });
    next();
  });
}

export function publicStaffUser(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    hasProfileAvatar: Boolean(row.profile_avatar_filename),
    createdAt: row.created_at,
    loginEnabled: row.login_enabled !== false,
  };
}

export function normalizeServiceIds(rawServices) {
  if (!Array.isArray(rawServices)) return null;
  return normalizeClientServiceIds(rawServices);
}

export function platformAvatarContentType(filename) {
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

export async function assertClientOrganizationPlatform(id) {
  const org = await Organization.getOrganization(id);
  if (!org || org.kind !== 'client') return null;
  return org;
}

export async function assertClientUserInOrg(orgId, userId) {
  const org = await assertClientOrganizationPlatform(orgId);
  if (!org) return null;
  const target = await User.findUserById(userId);
  if (!target || target.deactivated_at || String(target.organization_id) !== String(org.id)) {
    return null;
  }
  return target;
}

export function publicPulseSessionRow(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    audience: row.audience || 'staff',
    sessionPurpose: row.session_purpose || 'standard',
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

export function sendAvatarFileOr404(res, filename) {
  const safeName = path.basename(filename);
  const full = path.resolve(avatarFilePath(safeName));
  const { avatarsDir } = ensureStorageDirs();
  const root = path.resolve(avatarsDir);
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.status(403).end();
    return;
  }
  if (!fs.existsSync(full)) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', platformAvatarContentType(safeName));
  res.setHeader('Cache-Control', 'private, no-cache');
  res.sendFile(full);
}

export function sendOrgLogoFileOr404(res, filename) {
  const safeName = path.basename(filename);
  const full = path.resolve(orgLogoFilePath(safeName));
  const { orgLogosDir } = ensureStorageDirs();
  const root = path.resolve(orgLogosDir);
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.status(403).end();
    return;
  }
  if (!fs.existsSync(full)) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', platformAvatarContentType(safeName));
  res.setHeader('Cache-Control', 'private, no-cache');
  res.sendFile(full);
}
