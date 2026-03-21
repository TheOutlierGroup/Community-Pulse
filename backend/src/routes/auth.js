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

router.post(
  '/login',
  authLimiter,
  requireBodyFields(['email', 'password']),
  async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findUserByEmail(email);
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
    });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organization_id,
      },
    });
  }
);

router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organization_id,
  });
});

router.get('/invite/:token', authLimiter, async (req, res) => {
  const invite = await Invite.findValidInvite(req.params.token);
  if (!invite) {
    return res.status(404).json({ error: 'Invalid or expired invite' });
  }
  res.json({ email: invite.email, organizationId: invite.organization_id });
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
    const hash = await bcrypt.hash(password, 12);
    const user = await User.createUser({
      email: invite.email,
      passwordHash: hash,
      role: 'employee',
      organizationId: invite.organization_id,
    });
    await Invite.markInviteUsed(invite.id);
    const jwt = signToken({
      sub: user.id,
      role: user.role,
      organizationId: user.organization_id,
    });
    res.status(201).json({
      token: jwt,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organization_id,
      },
    });
  }
);

export default router;
