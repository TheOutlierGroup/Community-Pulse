import { Router } from 'express';
import {
  requireAuth,
  requireAdmin,
  requireClientOrganization,
  requireClientPulseService,
} from '../middleware/auth.js';
import * as PulseSession from '../models/PulseSession.js';
import * as EmployeeResponse from '../models/EmployeeResponse.js';
import * as ActionPlan from '../models/ActionPlan.js';
import { aggregateSessionResponses } from '../services/analytics.js';
import { buildActionPlanDraft } from '../services/pulseEngine.js';
import { writeSessionExport } from '../services/exportService.js';

const router = Router();

router.use(requireAuth, requireAdmin, requireClientOrganization, requireClientPulseService);

router.get('/sessions/:id', async (req, res) => {
  const session = await PulseSession.getSessionById(
    req.params.id,
    req.user.organizationId
  );
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const rows = await EmployeeResponse.listResponsesForSession(session.id);
  const analytics = aggregateSessionResponses(rows);
  const plan = await ActionPlan.getActionPlan(session.id, req.user.organizationId);
  res.json({ session, analytics, actionPlan: plan });
});

router.post('/sessions/:id/action-plan', async (req, res) => {
  const session = await PulseSession.getSessionById(
    req.params.id,
    req.user.organizationId
  );
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const rows = await EmployeeResponse.listResponsesForSession(session.id);
  const analytics = aggregateSessionResponses(rows);
  const draft = buildActionPlanDraft({
    hotspots: analytics.hotspots,
    strengths: analytics.strengths,
    tensionPairs: analytics.tensionPairs,
    participationRate: analytics.participationRate,
    avgNps: analytics.avgNps ?? 0,
  });
  const saved = await ActionPlan.upsertActionPlan(
    session.id,
    req.user.organizationId,
    draft
  );
  res.json({ actionPlan: saved, analyticsSnapshot: analytics });
});

router.get('/sessions/:id/action-plan', async (req, res) => {
  const session = await PulseSession.getSessionById(
    req.params.id,
    req.user.organizationId
  );
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const plan = await ActionPlan.getActionPlan(session.id, req.user.organizationId);
  res.json({ actionPlan: plan });
});

router.post('/sessions/:id/export', async (req, res) => {
  const session = await PulseSession.getSessionById(
    req.params.id,
    req.user.organizationId
  );
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const rows = await EmployeeResponse.listResponsesForSession(session.id);
  const analytics = aggregateSessionResponses(rows);
  const plan = await ActionPlan.getActionPlan(session.id, req.user.organizationId);
  const { filename } = await writeSessionExport(session.id, {
    session,
    exportedAt: new Date().toISOString(),
    analytics,
    actionPlan: plan,
    responses: rows.map((r) => ({
      email: r.email,
      completedAt: r.completed_at,
      contributionStyle: r.contribution_style,
      step1: r.step1_data,
      step2: r.step2_data,
      step3: r.step3_data,
      step4: r.step4_data,
    })),
  });
  res.json({ ok: true, filename, downloadPath: `/api/exports/${filename}` });
});

export default router;
