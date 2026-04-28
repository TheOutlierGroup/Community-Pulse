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
import * as PulseSessionStatusEvent from '../models/PulseSessionStatusEvent.js';
import * as Invite from '../models/Invite.js';
import {
  listSessionResponses,
  RESPONSE_MODE_EMPLOYEE_ONLY,
} from '../services/pulseDataContract.js';

export function createAdminRoutes({
  authMiddleware = requireAuth,
  adminMiddleware = requireAdmin,
  clientOrgMiddleware = requireClientOrganization,
  pulseServiceMiddleware = requireClientPulseService,
  pulseSessionModel = PulseSession,
  inviteModel = Invite,
  listSessionResponsesFn = listSessionResponses,
  responseModeEmployeeOnly = RESPONSE_MODE_EMPLOYEE_ONLY,
} = {}) {
  const router = Router();

  router.use(authMiddleware, adminMiddleware, clientOrgMiddleware, pulseServiceMiddleware);

  router.get('/overview', async (req, res) => {
    const sessions = await pulseSessionModel.listSessionsForOrg(req.user.organizationId);
    const activeStaff =
      sessions.find((s) => s.status === 'active' && s.audience === 'staff') ||
      sessions.find((s) => s.status === 'active');
    let participation = { total: 0, completed: 0 };
    if (activeStaff) {
      const mode = req.query?.responseMode === responseModeEmployeeOnly
        ? responseModeEmployeeOnly
        : undefined;
      const { rows } = await listSessionResponsesFn(activeStaff.id, { mode });
      participation = {
        total: rows.length,
        completed: rows.filter((row) => row.completed_at).length,
      };
    }
    res.json({
      sessions,
      activeSession: activeStaff || null,
      participation,
    });
  });

  router.post('/sessions', requireBodyFields(['name']), async (req, res) => {
    const { name, status = 'draft', audience = 'staff' } = req.body;
    if (!['draft', 'active', 'paused', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const aud = audience === 'manager' ? 'manager' : 'staff';
    const session = await pulseSessionModel.createSession(req.user.organizationId, name, status, aud);
    res.status(201).json(session);
  });

  router.patch('/sessions/:id', async (req, res) => {
    const { status } = req.body;
    if (!status || !['draft', 'active', 'paused', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const updated = await pulseSessionModel.updateSessionStatus(
      req.params.id,
      req.user.organizationId,
      status,
      { actorUserId: req.user.id, metadata: { source: 'adminRoute' } }
    );
    if (!updated) return res.status(404).json({ error: 'Session not found' });
    res.json(updated);
  });

  router.get('/sessions/:id/responses', async (req, res) => {
  const session = await pulseSessionModel.getSessionById(
    req.params.id,
    req.user.organizationId
  );
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const mode = req.query?.responseMode === responseModeEmployeeOnly
    ? responseModeEmployeeOnly
    : undefined;
  const { rows, responseContract } = await listSessionResponsesFn(session.id, { mode });
  res.json({ session, responses: rows, responseContract });
  });

  router.get('/sessions/:id/status-events', async (req, res) => {
    const session = await pulseSessionModel.getSessionById(req.params.id, req.user.organizationId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const events = await PulseSessionStatusEvent.listStatusEventsForSession(session.id);
    res.json({ sessionId: session.id, events });
  });

  router.post('/invites', requireBodyFields(['email']), async (req, res) => {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
  const invite = await inviteModel.createInvite({
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

  return router;
}

export default createAdminRoutes();
