import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { extensionForUpload } from '../../middleware/avatarUpload.js';
import { avatarFilePath, ensureStorageDirs, orgLogoFilePath } from '../../config/storage.js';
import * as Organization from '../../models/Organization.js';
import * as User from '../../models/User.js';
import * as ClientWorkTask from '../../models/ClientWorkTask.js';
import * as PlatformUserClientAssignment from '../../models/PlatformUserClientAssignment.js';
import {
  normalizeClientServiceIds,
  organizationVisibleToBusinessUnits,
  organizationHasEnterprisePortalTier,
} from '../../services/clientServices.js';
import { normalizePulseStage } from '../../services/pulseStage.js';

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

/**
 * Returns null for admin/platform-tier platform-org users (unrestricted
 * Clients/Prospects visibility). Returns the user's tagged Business Units
 * (possibly []) for basic-tier users, who are scoped to only Clients/
 * Prospects tagged with one of those units.
 */
export async function resolveBasicTierBusinessUnitScope(user) {
  if (!user || user.role !== 'basic') return null;
  return User.getBusinessUnitsForUser(user.id);
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
    deactivatedAt: row.deactivated_at || null,
  };
}

export function normalizeServiceIds(rawServices, allowedServiceIds = null) {
  if (!Array.isArray(rawServices)) return null;
  return normalizeClientServiceIds(rawServices, allowedServiceIds);
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
  if (!org || (org.kind !== 'client' && org.kind !== 'licensee')) return null;
  return org;
}

/**
 * DAT-01 decision core. Pure function — no DB. Given the requester
 * org/role, the target org, and (only when it could matter) the
 * already-resolved platform-user assignment / task-stake booleans,
 * decide whether the requester may read or mutate the target org.
 *
 * The pure split is what lets us cover every cross-tenant scenario in
 * fast unit tests without standing up Postgres.
 */
export function canPlatformUserAccessClientOrgPure({
  user,
  requesterOrg,
  targetOrg,
  hasAssignment = false,
  hasTaskStake = false,
  businessUnitVisible = false,
}) {
  if (!user || !requesterOrg || !targetOrg) return false;
  if (targetOrg.kind !== 'client' && targetOrg.kind !== 'licensee') return false;
  if (requesterOrg.kind === 'platform') {
    // Admin and Platform tier get unrestricted visibility (BU tags are
    // cosmetic for them, same as the Clients list).
    if (user.role === 'admin' || user.role === 'platform') return true;
    // Non-admin/non-platform users (Basic tier, and any legacy 'employee'
    // row) may only see clients they've been deliberately granted, never
    // licensee orgs.
    if (targetOrg.kind === 'licensee') return false;
    return Boolean(hasAssignment || hasTaskStake || businessUnitVisible);
  }
  if (requesterOrg.kind === 'licensee') {
    // Licensees can only see their *own* downstream clients. They cannot
    // see other licensees, sibling licensees' clients, or the platform.
    if (targetOrg.kind !== 'client') return false;
    return targetOrg.parent_organization_id === requesterOrg.id;
  }
  if (requesterOrg.kind === 'client') {
    // Enterprise self-service: a client org's own admin/employee may only
    // ever reach their own org, and only when the Enterprise portal tier is
    // enabled. On the main platform router this branch is unreachable
    // (requireWorkspaceUser already rejects client orgs before any handler
    // runs) — it only ever fires through platformEnterpriseSelfRouter.js.
    if (targetOrg.kind !== 'client' || targetOrg.id !== requesterOrg.id) return false;
    return organizationHasEnterprisePortalTier(requesterOrg.settings);
  }
  return false;
}

export async function canPlatformUserAccessClientOrg(user, clientOrgId) {
  if (!user || !clientOrgId) return false;
  const [requesterOrg, targetOrg] = await Promise.all([
    Organization.getOrganization(user.organizationId),
    Organization.getOrganization(clientOrgId),
  ]);
  if (!requesterOrg || !targetOrg) return false;
  if (targetOrg.kind !== 'client' && targetOrg.kind !== 'licensee') return false;
  // Resolve the secondary signals only when the pure decision would
  // actually consult them — this preserves the previous lazy behaviour.
  let hasAssignment = false;
  let hasTaskStake = false;
  let businessUnitVisible = false;
  if (
    requesterOrg.kind === 'platform' &&
    user.role !== 'admin' &&
    user.role !== 'platform' &&
    targetOrg.kind === 'client'
  ) {
    if (user.role === 'basic') {
      const businessUnits = await User.getBusinessUnitsForUser(user.id);
      businessUnitVisible = organizationVisibleToBusinessUnits(targetOrg.settings, businessUnits);
    }
    if (!businessUnitVisible) {
      hasAssignment = await PlatformUserClientAssignment.userHasClientOrgAssignment(
        user.id,
        clientOrgId
      );
      if (!hasAssignment) {
        hasTaskStake = await ClientWorkTask.platformUserHasStakeInClientOrgTasks(
          user.id,
          clientOrgId
        );
      }
    }
  }
  return canPlatformUserAccessClientOrgPure({
    user,
    requesterOrg,
    targetOrg,
    hasAssignment,
    hasTaskStake,
    businessUnitVisible,
  });
}

export async function assertClientOrganizationPlatformForUser(id, user) {
  const org = await assertClientOrganizationPlatform(id);
  if (!org) return null;
  const allowed = await canPlatformUserAccessClientOrg(user, org.id);
  if (!allowed) return null;
  return org;
}

export async function assertClientUserInOrg(orgId, userId, viewerUser = null) {
  const org = viewerUser
    ? await assertClientOrganizationPlatformForUser(orgId, viewerUser)
    : await assertClientOrganizationPlatform(orgId);
  if (!org) return null;
  const target = await User.findUserById(userId);
  if (!target || target.deactivated_at || String(target.organization_id) !== String(org.id)) {
    return null;
  }
  return target;
}

export function publicPulseSessionRow(row) {
  const purpose = String(row.session_purpose || '').trim().toLowerCase();
  const stage = normalizePulseStage(
    purpose === 'during_project' ? 'mid' : purpose === 'completed_project' ? 'post' : 'pre'
  );
  const isSystemGeneratedDuring = purpose === 'standard';
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    audience: row.audience || 'staff',
    sessionPurpose: row.session_purpose || 'standard',
    isSystemGeneratedDuring,
    stage,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    labelDate: row.label_date || null,
    respondentCapOverride:
      row.respondent_cap_override == null ? null : Number(row.respondent_cap_override),
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
