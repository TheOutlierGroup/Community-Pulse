import fs from 'fs';
import { randomUUID } from 'crypto';
import { requireBodyFields } from '../../middleware/validation.js';
import { extensionForUpload } from '../../middleware/avatarUpload.js';
import { avatarFilePath, orgLogoFilePath } from '../../config/storage.js';
import * as Organization from '../../models/Organization.js';
import * as User from '../../models/User.js';
import * as Invite from '../../models/Invite.js';
import * as PulseSession from '../../models/PulseSession.js';
import {
  assertClientOrganizationPlatform,
  assertClientUserInOrg,
  handleOrgLogoPlatformUpload,
  handlePlatformUserCreateUpload,
  normalizeServiceIds,
  publicPulseSessionRow,
  publicStaffUser,
  sendAvatarFileOr404,
  sendOrgLogoFileOr404,
} from './shared.js';

function parsePagination(query) {
  const rawLimit = Number.parseInt(String(query?.limit ?? ''), 10);
  const rawOffset = Number.parseInt(String(query?.offset ?? ''), 10);
  return {
    limit: Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 200,
    offset: Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0,
  };
}

export function registerPlatformOrgRoutes(router) {
  router.get('/organizations', async (req, res) => {
    const rows = await Organization.listOrganizationsByKind('client', parsePagination(req.query));
    res.json({ organizations: rows });
  });

  router.post('/organizations', handleOrgLogoPlatformUpload, async (req, res) => {
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
        await fs.promises.writeFile(orgLogoFilePath(base), req.file.buffer);
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
    let settingsPatch = settings;
    if (settings !== undefined) {
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return res.status(400).json({ error: 'settings must be an object' });
      }
      settingsPatch = { ...settings };
      if (Object.prototype.hasOwnProperty.call(settingsPatch, 'services')) {
        const normalized = normalizeServiceIds(settingsPatch.services);
        if (normalized == null) {
          return res.status(400).json({ error: 'settings.services must be an array' });
        }
        settingsPatch.services = normalized;
        if (Object.prototype.hasOwnProperty.call(settingsPatch, 'pulseEnabled')) {
          delete settingsPatch.pulseEnabled;
        }
      }
    }
    const updated = await Organization.updateOrganizationClient(req.params.id, {
      name,
      settings: settingsPatch,
    });
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
      ...parsePagination(req.query),
    });
    res.json({ users: users.map(publicStaffUser) });
  });

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
    sendAvatarFileOr404(res, name);
  });

  router.post('/organizations/:id/users/:userId/avatar', handlePlatformUserCreateUpload, async (req, res) => {
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

  router.delete('/organizations/:id/users/:userId/avatar', async (req, res) => {
    const orgId = req.params.id;
    const { userId } = req.params;
    const target = await assertClientUserInOrg(orgId, userId);
    if (!target) return res.status(404).json({ error: 'User not found' });
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
      inviteUrl: `/invite/${token}`,
    });
  });

  router.get('/organizations/:id', async (req, res) => {
    const org = await assertClientOrganizationPlatform(req.params.id);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    res.json({ organization: org });
  });

  router.get('/organizations/:id/logo', async (req, res) => {
    const org = await assertClientOrganizationPlatform(req.params.id);
    if (!org || !org.company_logo_filename) return res.status(404).end();
    sendOrgLogoFileOr404(res, org.company_logo_filename);
  });

  router.post('/organizations/:id/logo', handleOrgLogoPlatformUpload, async (req, res) => {
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
          await fs.promises.unlink(orgLogoFilePath(org.company_logo_filename));
        } catch {
          /* ignore */
        }
      }
      await fs.promises.writeFile(orgLogoFilePath(base), req.file.buffer);
      const updated = await Organization.setCompanyLogoFilename(org.id, base);
      res.json({ organization: updated });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Could not save logo' });
    }
  });

  router.delete('/organizations/:id/logo', async (req, res) => {
    const org = await assertClientOrganizationPlatform(req.params.id);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const prev = await Organization.clearCompanyLogoFilename(req.params.id);
    if (prev) {
      try {
        await fs.promises.unlink(orgLogoFilePath(prev));
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
}
