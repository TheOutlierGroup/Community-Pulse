import { Router } from 'express';
import {
  requireAuth,
  requireAdmin,
  requireClientOrganization,
  requireClientPulseService,
} from '../middleware/auth.js';
import * as PulseSession from '../models/PulseSession.js';
import * as ActionPlan from '../models/ActionPlan.js';
import { aggregateSessionResponses } from '../services/analytics.js';
import { buildActionPlanDraft } from '../services/pulseEngine.js';
import { writeSessionExport } from '../services/exportService.js';
import {
  listSessionResponses,
  RESPONSE_MODE_EMPLOYEE_ONLY,
} from '../services/pulseDataContract.js';
import { normalizePulseStage } from '../services/pulseStage.js';

export function createAnalyticsRoutes({
  authMiddleware = requireAuth,
  adminMiddleware = requireAdmin,
  clientOrgMiddleware = requireClientOrganization,
  pulseServiceMiddleware = requireClientPulseService,
  pulseSessionModel = PulseSession,
  actionPlanModel = ActionPlan,
  aggregateSessionResponsesFn = aggregateSessionResponses,
  buildActionPlanDraftFn = buildActionPlanDraft,
  writeSessionExportFn = writeSessionExport,
  listSessionResponsesFn = listSessionResponses,
  responseModeEmployeeOnly = RESPONSE_MODE_EMPLOYEE_ONLY,
} = {}) {
  const router = Router();

  router.use(authMiddleware, adminMiddleware, clientOrgMiddleware, pulseServiceMiddleware);

  router.get('/sessions/:id', async (req, res) => {
  const session = await pulseSessionModel.getSessionById(
    req.params.id,
    req.user.organizationId
  );
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const mode = req.query?.responseMode === responseModeEmployeeOnly
    ? responseModeEmployeeOnly
    : undefined;
  const stage = req.query?.stage ? normalizePulseStage(req.query.stage) : null;
  const { rows, responseContract } = await listSessionResponsesFn(session.id, { mode, stage });
  const analytics = aggregateSessionResponsesFn(rows);
  const plan = await actionPlanModel.getActionPlan(session.id, req.user.organizationId);
  res.json({ session, analytics, actionPlan: plan, responseContract });
  });

  router.post('/sessions/:id/action-plan', async (req, res) => {
  const session = await pulseSessionModel.getSessionById(
    req.params.id,
    req.user.organizationId
  );
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const mode = req.query?.responseMode === responseModeEmployeeOnly
    ? responseModeEmployeeOnly
    : undefined;
  const stage = req.query?.stage ? normalizePulseStage(req.query.stage) : null;
  const { rows, responseContract } = await listSessionResponsesFn(session.id, { mode, stage });
  const analytics = aggregateSessionResponsesFn(rows);
  const draft = buildActionPlanDraftFn({
    hotspots: analytics.hotspots,
    strengths: analytics.strengths,
    tensionPairs: analytics.tensionPairs,
    participationRate: analytics.participationRate,
    avgNps: analytics.avgNps ?? 0,
  });
  const saved = await actionPlanModel.upsertActionPlan(
    session.id,
    req.user.organizationId,
    draft
  );
  res.json({ actionPlan: saved, analyticsSnapshot: analytics, responseContract });
  });

  router.get('/sessions/:id/action-plan', async (req, res) => {
  const session = await pulseSessionModel.getSessionById(
    req.params.id,
    req.user.organizationId
  );
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const plan = await actionPlanModel.getActionPlan(session.id, req.user.organizationId);
  res.json({ actionPlan: plan });
  });

  router.post('/sessions/:id/export', async (req, res) => {
  const session = await pulseSessionModel.getSessionById(
    req.params.id,
    req.user.organizationId
  );
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const mode = req.query?.responseMode === responseModeEmployeeOnly
    ? responseModeEmployeeOnly
    : undefined;
  const stage = req.query?.stage ? normalizePulseStage(req.query.stage) : null;
  const { rows, responseContract } = await listSessionResponsesFn(session.id, { mode, stage });
  const analytics = aggregateSessionResponsesFn(rows);
  const plan = await actionPlanModel.getActionPlan(session.id, req.user.organizationId);
  const { filename } = await writeSessionExportFn(session.id, {
    session,
    exportedAt: new Date().toISOString(),
    analytics,
    actionPlan: plan,
    responses: rows.map((r) => ({
      sourceType: r.source_type || 'employee',
      stage: r.stage || 'pre',
      completedAt: r.completed_at,
      contributionStyle: r.contribution_style,
    })),
  });
  res.json({ ok: true, filename, downloadPath: `/api/exports/${filename}`, responseContract });
  });

  return router;
}

export default createAnalyticsRoutes();
