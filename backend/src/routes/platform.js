import { Router } from 'express';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { requireAuth, requirePlatformAdmin } from '../middleware/auth.js';
import { requireBodyFields } from '../middleware/validation.js';
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
  const users = await User.listUsersForOrg(req.user.organizationId, { role: 'admin' });
  res.json({ users });
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
