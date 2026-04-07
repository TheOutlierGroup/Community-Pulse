import { Router } from 'express';
import { randomUUID } from 'crypto';
import {
  requireAuth,
  requireAdmin,
  requireClientOrganization,
  requireClientPulseService,
} from '../middleware/auth.js';
import { requireBodyFields } from '../middleware/validation.js';
import * as PulseSession from '../models/PulseSession.js';
import * as EmployeeResponse from '../models/EmployeeResponse.js';
import * as Invite from '../models/Invite.js';

const router = Router();

router.use(requireAuth, requireAdmin, requireClientOrganization, requireClientPulseService);

router.get('/overview', async (req, res) => {
  const sessions = await PulseSession.listSessionsForOrg(req.user.organizationId);
  const activeStaff =
    sessions.find((s) => s.status === 'active' && s.audience === 'staff') ||
    sessions.find((s) => s.status === 'active');
  let participation = { total: 0, completed: 0 };
  if (activeStaff) {
    participation = await EmployeeResponse.countParticipationForSession(activeStaff.id);
  }
  res.json({
    sessions,
    activeSession: activeStaff || null,
    participation,
  });
});

router.post('/sessions', requireBodyFields(['name']), async (req, res) => {
  const { name, status = 'draft', audience = 'staff' } = req.body;
  if (!['draft', 'active', 'closed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const aud = audience === 'manager' ? 'manager' : 'staff';
  const session = await PulseSession.createSession(req.user.organizationId, name, status, aud);
  res.status(201).json(session);
});

router.patch('/sessions/:id', async (req, res) => {
  const { status } = req.body;
  if (!status || !['draft', 'active', 'closed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const updated = await PulseSession.updateSessionStatus(
    req.params.id,
    req.user.organizationId,
    status
  );
  if (!updated) return res.status(404).json({ error: 'Session not found' });
  res.json(updated);
});

router.get('/sessions/:id/responses', async (req, res) => {
  const session = await PulseSession.getSessionById(
    req.params.id,
    req.user.organizationId
  );
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const rows = await EmployeeResponse.listResponsesForSession(session.id);
  res.json({ session, responses: rows });
});

router.post('/invites', requireBodyFields(['email']), async (req, res) => {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
  const invite = await Invite.createInvite({
    email: req.body.email,
    token,
    organizationId: req.user.organizationId,
    expiresAt,
    invitedRole: 'employee',
    firstName: req.body.firstName,
    lastName: req.body.lastName,
  });
  res.status(201).json({
    invite: {
      id: invite.id,
      email: invite.email,
      expiresAt: invite.expires_at,
      token,
    },
    inviteUrl: `/invite/${token}`,
  });
});

export default router;
