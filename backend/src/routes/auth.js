import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { signToken, requireAuth } from '../middleware/auth.js';
import { requireBodyFields } from '../middleware/validation.js';
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
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(publicUser(user));
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
