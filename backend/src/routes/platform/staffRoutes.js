import fs from 'fs';
import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import { requireBodyFields } from '../../middleware/validation.js';
import { extensionForUpload } from '../../middleware/avatarUpload.js';
import { avatarFilePath } from '../../config/storage.js';
import * as Organization from '../../models/Organization.js';
import * as User from '../../models/User.js';
import * as ClientWorkTask from '../../models/ClientWorkTask.js';
import * as PlatformUserClientAssignment from '../../models/PlatformUserClientAssignment.js';
import * as Invite from '../../models/Invite.js';
import * as LicenseConfig from '../../models/LicenseConfig.js';
import * as PasswordResetToken from '../../models/PasswordResetToken.js';
import { BUSINESS_UNITS } from '../../models/CrmOrganisation.js';
import {
  handlePlatformUserCreateUpload,
  publicStaffUser,
  sendAvatarFileOr404,
} from './shared.js';
import { isResendConfigured, sendPlatformWelcomeEmail } from '../../services/email.js';
import { organizationHasEnterprisePortalTier } from '../../services/clientServices.js';
import { requirePlatformOnlyUser, requireAtLeastPlatformTier } from '../../middleware/auth.js';
import { auditFromRequest, AUDIT_ACTIONS, listRecentAuditEvents, publicAuditEvent } from '../../services/auditLog.js';
import {
  inviteSendLimiter,
  passwordResetByAdminLimiter,
} from '../../middleware/sensitiveRateLimit.js';

const PLATFORM_WELCOME_RESET_MS = 7 * 24 * 60 * 60 * 1000;

function resolvePublicAppBaseUrl() {
  const raw =
    process.env.CRM_APP_URL
    || process.env.APP_URL
    || String(process.env.FRONTEND_ORIGIN || '').split(',')[0].trim();
  return raw ? raw.replace(/\/$/, '') : '';
}

// Only platform-kind orgs (Outlier's own staff) use the 3-tier role model
// and BU tags; licensee orgs keep the historical admin/employee pair with
// 'admin' as the safe fallback, exactly as before this feature existed.
function roleOptionsForWorkspace(workspaceOrganization) {
  return workspaceOrganization?.kind === 'platform'
    ? { allowedRoles: User.PLATFORM_ORG_ROLES, invalidRoleFallback: 'basic' }
    : { allowedRoles: ['admin', 'employee'], invalidRoleFallback: 'admin' };
}

function parseBusinessUnits(rawBusinessUnits) {
  const list = Array.isArray(rawBusinessUnits)
    ? rawBusinessUnits
    : rawBusinessUnits != null && rawBusinessUnits !== ''
      ? [rawBusinessUnits]
      : [];
  return list
    .map((bu) => String(bu || '').trim())
    .filter((bu) => BUSINESS_UNITS.includes(bu));
}

function parsePagination(query) {
  const rawLimit = Number.parseInt(String(query?.limit ?? ''), 10);
  const rawOffset = Number.parseInt(String(query?.offset ?? ''), 10);
  return {
    limit: Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 200,
    offset: Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0,
  };
}

function formatIsoDate(d) {
  if (d == null) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
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
    position: 0,
  };
}

// Returns null if the org may add another admin, or {status, error} if the
// licence_config admin_user_limit would be exceeded. Only enforces for orgs
// that have a licence_config row (currently licensee orgs).
async function assertAdminUserLimitOrError(organizationId) {
  const config = await LicenseConfig.getForOrganization(organizationId);
  if (!config) return null;
  const counts = await User.countActiveUsersByRoleForOrg(organizationId);
  const currentAdmins = counts.admin || 0;
  if (currentAdmins >= config.admin_user_limit) {
    return {
      status: 402,
      error: `Admin user limit reached for this licence (${config.admin_user_limit}). Contact Outlier to raise the limit.`,
    };
  }
  return null;
}

export function registerPlatformStaffRoutes(router) {
  const requirePlatformAdminRole = (req, res, next) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    next();
  };

  // Mutating routes stay admin-only (Level 1 Platform loses edit rights,
  // same as it always has for licensee orgs). Read routes are split out
  // below with requireAtLeastPlatformTier so Platform-tier platform-org
  // staff get read-only Users visibility; licensee users can never hold
  // role 'platform' so this is a pure addition for platform-kind orgs.
  router.get('/staff', requireAtLeastPlatformTier, async (req, res) => {
    const isPlatformOrg = req.workspaceOrganization?.kind === 'platform';
    const users = await User.listUsersForOrg(req.user.organizationId, parsePagination(req.query));
    const assignmentCounts = await PlatformUserClientAssignment.listAssignmentCountsForUsers(
      users.map((row) => row.id)
    );
    const businessUnitsByUser = isPlatformOrg
      ? await User.getBusinessUnitsForUsers(users.map((row) => row.id))
      : new Map();
    const outUsers = users.map((row) => ({
      ...publicStaffUser(row),
      assignmentCount:
        row.role === 'employee' ? assignmentCounts.get(String(row.id)) || 0 : null,
      businessUnits: isPlatformOrg ? businessUnitsByUser.get(String(row.id)) || [] : undefined,
    }));
    res.json({ users: outUsers });
  });

  router.get('/users/:userId/avatar', requireAtLeastPlatformTier, async (req, res) => {
    const target = await User.findUserById(req.params.userId);
    if (!target || target.deactivated_at || target.organization_id !== req.user.organizationId) {
      return res.status(404).end();
    }
    const name = await User.getProfileAvatarFilename(req.params.userId);
    if (!name) return res.status(404).end();
    sendAvatarFileOr404(res, name);
  });

  router.use('/staff', requirePlatformAdminRole);
  router.use('/users', requirePlatformAdminRole);

  router.get('/staff/:userId/client-assignments', requirePlatformOnlyUser, async (req, res) => {
    const target = await User.findUserById(req.params.userId);
    if (!target || target.deactivated_at || target.organization_id !== req.user.organizationId) {
      return res.status(404).json({ error: 'User not found' });
    }
    const assignedOrgIds = await PlatformUserClientAssignment.listAssignedClientOrgIdsForUser(target.id);
    const organizations = await Organization.listClientOrganizationsByIds(assignedOrgIds, {
      limit: 500,
      offset: 0,
    });
    res.json({
      userId: target.id,
      clientOrganizationIds: assignedOrgIds,
      organizations,
    });
  });

  router.get('/staff/:userId/tasks', requirePlatformOnlyUser, async (req, res) => {
    const target = await User.findUserById(req.params.userId);
    if (!target || target.deactivated_at || target.organization_id !== req.user.organizationId) {
      return res.status(404).json({ error: 'User not found' });
    }
    const rows = await ClientWorkTask.listTasksAssignedToUserAcrossClientOrgs(target.id);
    res.json({ tasks: rows.map(publicStaffAssignedTask) });
  });

  router.put('/staff/:userId/client-assignments', requirePlatformOnlyUser, async (req, res) => {
    const target = await User.findUserById(req.params.userId);
    if (!target || target.deactivated_at || target.organization_id !== req.user.organizationId) {
      return res.status(404).json({ error: 'User not found' });
    }
    const clientOrganizationIds = Array.isArray(req.body?.clientOrganizationIds)
      ? req.body.clientOrganizationIds.map((id) => String(id || '').trim()).filter(Boolean)
      : null;
    if (!clientOrganizationIds) {
      return res.status(400).json({ error: 'clientOrganizationIds must be an array' });
    }
    const candidateRows = await Organization.listClientOrganizationsByIds(clientOrganizationIds, {
      limit: 1000,
      offset: 0,
    });
    const found = new Set(candidateRows.map((row) => String(row.id)));
    const invalid = clientOrganizationIds.filter((id) => !found.has(String(id)));
    if (invalid.length) {
      return res.status(400).json({ error: 'Invalid client organization ids', invalidClientOrganizationIds: invalid });
    }
    const savedIds = await PlatformUserClientAssignment.replaceAssignmentsForUser(target.id, clientOrganizationIds);
    const organizations = await Organization.listClientOrganizationsByIds(savedIds, {
      limit: 1000,
      offset: 0,
    });
    res.json({
      userId: target.id,
      clientOrganizationIds: savedIds,
      organizations,
    });
  });

  router.post('/users', inviteSendLimiter, handlePlatformUserCreateUpload, async (req, res) => {
    const firstName = req.body.firstName ?? '';
    const lastName = req.body.lastName ?? '';
    const email = req.body.email;
    const password = req.body.password;
    const isPlatformOrg = req.workspaceOrganization?.kind === 'platform';
    const { allowedRoles, invalidRoleFallback } = roleOptionsForWorkspace(req.workspaceOrganization);
    const role = allowedRoles.includes(req.body.role) ? req.body.role : invalidRoleFallback;
    const businessUnits = isPlatformOrg ? parseBusinessUnits(req.body.businessUnits) : [];
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
    const emailNorm = String(email).trim().toLowerCase();
    const existing = await User.findUserByEmail(emailNorm);
    let reactivated = false;
    let rowId;

    if (existing) {
      const sameOrg = String(existing.organization_id) === String(req.user.organizationId);
      if (!existing.deactivated_at || !sameOrg) {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }
      if (role === 'admin') {
        const limitError = await assertAdminUserLimitOrError(req.user.organizationId);
        if (limitError) return res.status(limitError.status).json({ error: limitError.error });
      }
      const okRe = await User.reactivateUserInOrg(existing.id, req.user.organizationId);
      if (!okRe) {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }
      reactivated = true;
      rowId = existing.id;
      const hash =
        trimmedPassword.length >= 8
          ? await bcrypt.hash(trimmedPassword, 12)
          : await bcrypt.hash(randomBytes(32).toString('base64url'), 12);
      await User.updateUserPassword(rowId, hash);
      await User.updateStaffUserInOrg(
        rowId,
        req.user.organizationId,
        { firstName, lastName, role, loginEnabled: true },
        { allowedRoles, invalidRoleFallback }
      );
      if (isPlatformOrg) await User.setBusinessUnitsForUser(rowId, businessUnits);
    } else {
      if (role === 'admin') {
        const limitError = await assertAdminUserLimitOrError(req.user.organizationId);
        if (limitError) return res.status(limitError.status).json({ error: limitError.error });
      }
      const hash =
        trimmedPassword.length >= 8
          ? await bcrypt.hash(trimmedPassword, 12)
          : await bcrypt.hash(randomBytes(32).toString('base64url'), 12);
      const row = await User.createUserWithProfile({
        email: emailNorm,
        passwordHash: hash,
        role,
        organizationId: req.user.organizationId,
        firstName,
        lastName,
      });
      rowId = row.id;
      if (isPlatformOrg) await User.setBusinessUnitsForUser(rowId, businessUnits);
    }

    let outRow = await User.findUserById(rowId);
    if (req.file) {
      const ext = extensionForUpload(req.file);
      const base = `${rowId}${ext || '.png'}`;
      try {
        await fs.promises.writeFile(avatarFilePath(base), req.file.buffer);
        await User.setProfileAvatarFilename(rowId, base);
        outRow = await User.findUserById(rowId);
      } catch (e) {
        console.error(e);
      }
    }

    let welcomeEmailSent = false;
    if (baseUrl && isResendConfigured()) {
      try {
        const resetToken = await PasswordResetToken.createResetToken(rowId, {
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
          emailNorm,
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

    auditFromRequest(req)({
      action: AUDIT_ACTIONS.USER_INVITE_SEND,
      targetType: 'user',
      targetId: outRow.id,
      targetOrganizationId: req.user.organizationId,
      metadata: {
        role,
        businessUnits: isPlatformOrg ? businessUnits : undefined,
        welcomeEmailSent,
        hasInitialPassword: trimmedPassword.length > 0,
        reactivated,
      },
    });
    res.status(reactivated ? 200 : 201).json({
      user: { ...publicStaffUser(outRow), businessUnits: isPlatformOrg ? businessUnits : undefined },
      welcomeEmailSent,
      reactivated,
    });
  });

  router.post(
    '/users/:userId/resend-welcome-email',
    inviteSendLimiter,
    async (req, res) => {
      const { userId } = req.params;
      const target = await User.findUserById(userId);
      if (!target || target.deactivated_at || target.organization_id !== req.user.organizationId) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (target.login_enabled === false) {
        return res.status(400).json({ error: 'Login is disabled for this user; enable login before sending email.' });
      }
      const baseUrl = resolvePublicAppBaseUrl();
      if (!baseUrl) {
        return res.status(400).json({
          error:
            'Set CRM_APP_URL (or APP_URL/FRONTEND_ORIGIN fallback) to send welcome email.',
        });
      }
      if (!isResendConfigured()) {
        return res.status(503).json({
          error: 'Email is not configured',
          details: 'Add RESEND_API_KEY to send welcome email.',
        });
      }
      let welcomeEmailSent = false;
      try {
        const resetToken = await PasswordResetToken.createResetToken(target.id, {
          expiresInMs: PLATFORM_WELCOME_RESET_MS,
        });
        const loginUrl = `${baseUrl}/login`;
        const setPasswordUrl = `${baseUrl}/reset-password/${resetToken}`;
        const org = await Organization.getOrganization(req.user.organizationId);
        const displayName = [target.first_name, target.last_name]
          .map((s) => String(s || '').trim())
          .filter(Boolean)
          .join(' ');
        await sendPlatformWelcomeEmail(
          String(target.email).trim(),
          displayName,
          loginUrl,
          setPasswordUrl,
          org?.name || 'Outlier'
        );
        welcomeEmailSent = true;
      } catch (e) {
        console.error('Platform resend welcome email failed:', e);
      }
      auditFromRequest(req)({
        action: AUDIT_ACTIONS.USER_INVITE_RESEND,
        targetType: 'user',
        targetId: target.id,
        targetOrganizationId: req.user.organizationId,
        metadata: { welcomeEmailSent },
      });
      res.json({ welcomeEmailSent });
    }
  );

  router.patch('/users/:userId', async (req, res) => {
    const { userId } = req.params;
    const target = await User.findUserById(userId);
    if (!target || target.deactivated_at || target.organization_id !== req.user.organizationId) {
      return res.status(404).json({ error: 'User not found' });
    }
    const isPlatformOrg = req.workspaceOrganization?.kind === 'platform';
    const { allowedRoles, invalidRoleFallback } = roleOptionsForWorkspace(req.workspaceOrganization);
    const body = req.body || {};
    const patch = {};
    if ('firstName' in body) patch.firstName = body.firstName;
    if ('lastName' in body) patch.lastName = body.lastName;
    if ('email' in body) patch.email = body.email;
    if ('role' in body) patch.role = body.role;
    const businessUnitsProvided = isPlatformOrg && 'businessUnits' in body;
    if (!Object.keys(patch).length && !businessUnitsProvided) {
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
    if (patch.role === 'admin' && target.role !== 'admin') {
      const limitError = await assertAdminUserLimitOrError(req.user.organizationId);
      if (limitError) return res.status(limitError.status).json({ error: limitError.error });
    }
    let row = target;
    if (Object.keys(patch).length) {
      row = await User.updateStaffUserInOrg(userId, req.user.organizationId, patch, {
        allowedRoles,
        invalidRoleFallback,
      });
      if (!row) return res.status(404).json({ error: 'User not found' });
    }
    let businessUnits;
    if (businessUnitsProvided) {
      businessUnits = await User.setBusinessUnitsForUser(userId, parseBusinessUnits(body.businessUnits));
    }
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.USER_UPDATE,
      targetType: 'user',
      targetId: userId,
      targetOrganizationId: req.user.organizationId,
      metadata: {
        patchedFields: Object.keys(patch),
        promotedToAdmin: patch.role === 'admin' && target.role !== 'admin',
        businessUnits,
      },
    });
    res.json({ user: { ...publicStaffUser(row), businessUnits } });
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
    if (!requesterOrg) return res.status(403).json({ error: 'Forbidden' });
    const targetOrg = await Organization.getOrganization(target.organization_id);
    if (!targetOrg) {
      return res.status(404).json({ error: 'User not found' });
    }
    let allowed = false;
    if (requesterOrg.kind === 'platform') {
      allowed =
        targetOrg.kind === 'client' ||
        targetOrg.kind === 'licensee' ||
        (targetOrg.kind === 'platform' && target.organization_id === req.user.organizationId);
    } else if (requesterOrg.kind === 'licensee') {
      allowed =
        target.organization_id === req.user.organizationId ||
        (targetOrg.kind === 'client' &&
          targetOrg.parent_organization_id === req.user.organizationId);
    } else if (requesterOrg.kind === 'client') {
      // Enterprise self-service: only the caller's own org, and only when
      // Enterprise portal tier is enabled for it.
      allowed =
        target.organization_id === req.user.organizationId &&
        organizationHasEnterprisePortalTier(requesterOrg.settings);
    }
    if (!allowed) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const ok = await User.deactivateUserInOrg(userId, target.organization_id);
    if (!ok) return res.status(404).json({ error: 'User not found' });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.USER_DEACTIVATE,
      targetType: 'user',
      targetId: userId,
      targetOrganizationId: target.organization_id,
      metadata: { wasRole: target.role, wasEmail: target.email },
    });
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

  router.post('/staff/invites', inviteSendLimiter, requireBodyFields(['email']), async (req, res) => {
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

  // Admin-only export of user-management audit events (create/edit/role
  // change/BU-tag change/deactivate) — every USER_* action in AUDIT_ACTIONS
  // uses targetType 'user', so filtering on that alone gets exactly this set
  // without a separate action allowlist to keep in sync.
  router.get('/users/audit-log/export', async (req, res, next) => {
    try {
      const rows = [];
      const pageSize = 500;
      let offset = 0;
      for (;;) {
        const page = await listRecentAuditEvents({
          organizationId: req.user.organizationId,
          targetType: 'user',
          limit: pageSize,
          offset,
        });
        rows.push(...page);
        if (page.length < pageSize || rows.length >= 10000) break;
        offset += pageSize;
      }
      const header = ['Occurred At', 'Actor Email', 'Actor Role', 'Action', 'Target User ID', 'Result', 'Metadata'];
      const csvEscape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const actorIds = [...new Set(rows.map((row) => row.actor_user_id).filter(Boolean))];
      const actors = await Promise.all(actorIds.map((id) => User.findUserById(id)));
      const actorEmailById = new Map(actors.filter(Boolean).map((u) => [String(u.id), u.email]));
      const lines = [header.map(csvEscape).join(',')];
      for (const row of rows) {
        const event = publicAuditEvent(row);
        lines.push(
          [
            event.occurredAt,
            actorEmailById.get(String(event.actorUserId)) || event.actorUserId || '',
            event.actorRole || '',
            event.action,
            event.targetId || '',
            event.result,
            JSON.stringify(event.metadata || {}),
          ]
            .map(csvEscape)
            .join(',')
        );
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="user-audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(lines.join('\n'));
    } catch (e) {
      next(e);
    }
  });

  router.patch('/users/:userId/password', passwordResetByAdminLimiter, requireBodyFields(['password']), async (req, res) => {
    const { password } = req.body;
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const target = await User.getUserOrgKind(req.params.userId);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }
    const requesterOrg = await Organization.getOrganization(req.user.organizationId);
    if (!requesterOrg) return res.status(403).json({ error: 'Forbidden' });
    const targetOrg = await Organization.getOrganization(target.organization_id);
    let allowed = false;
    if (requesterOrg.kind === 'platform') {
      allowed =
        target.kind === 'client' ||
        target.kind === 'licensee' ||
        (target.kind === 'platform' && target.organization_id === req.user.organizationId);
    } else if (requesterOrg.kind === 'licensee') {
      allowed =
        target.organization_id === req.user.organizationId ||
        (target.kind === 'client' &&
          targetOrg?.parent_organization_id === req.user.organizationId);
    }
    if (!allowed) {
      return res.status(403).json({ error: 'Cannot update this user' });
    }
    const hash = await bcrypt.hash(password, 12);
    const updated = await User.updateUserPassword(req.params.userId, hash);
    if (!updated) return res.status(404).json({ error: 'User not found' });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.USER_PASSWORD_RESET_BY_ADMIN,
      targetType: 'user',
      targetId: req.params.userId,
      targetOrganizationId: target.organization_id,
    });
    res.json({ ok: true });
  });
}
