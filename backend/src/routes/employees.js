import { Router } from 'express';
import { requireAuth, requireClientPulseService } from '../middleware/auth.js';
import * as PulseSession from '../models/PulseSession.js';
import * as EmployeeResponse from '../models/EmployeeResponse.js';
import {
  computeContributionStyle,
  buildPersonalReflection,
  getQuestionsForAudience,
  getSurveyCopyForAudience,
} from '../services/pulseEngine.js';
import { parsePulseStageFromRequest } from '../services/pulseStage.js';

export function createEmployeeRoutes({
  authMiddleware = requireAuth,
  pulseServiceMiddleware = requireClientPulseService,
  pulseSessionModel = PulseSession,
  employeeResponseModel = EmployeeResponse,
  computeContributionStyleFn = computeContributionStyle,
  buildPersonalReflectionFn = buildPersonalReflection,
  getQuestionsForAudienceFn = getQuestionsForAudience,
  getSurveyCopyForAudienceFn = getSurveyCopyForAudience,
} = {}) {
  const router = Router();

  router.use(authMiddleware, pulseServiceMiddleware);

  function stageForEmployeeSession(session) {
    const purpose = String(session?.session_purpose || '').trim().toLowerCase();
    if (purpose === 'during_project') return 'mid';
    if (purpose === 'completed_project') return 'post';
    return 'pre';
  }

  function validateRequestedStage(req, expectedStage) {
    const requested = parsePulseStageFromRequest(req, expectedStage);
    if (requested !== expectedStage) {
      return { ok: false, requested };
    }
    return { ok: true, requested };
  }

  router.get('/themes', (req, res) => {
    if (req.user.role !== 'employee') {
      return res.status(403).json({ error: 'Employees only' });
    }
    const stage = parsePulseStageFromRequest(req, 'pre');
    const questions = getQuestionsForAudienceFn('staff', stage);
    const copy = getSurveyCopyForAudienceFn('staff', stage);
    res.json({ questions, copy, stage });
  });

  router.get('/active-session', async (req, res) => {
    if (req.user.role !== 'employee') {
      return res.status(403).json({ error: 'Employees only' });
    }
    const session = await pulseSessionModel.getActiveSessionForOrg(req.user.organizationId, 'staff');
    if (!session) {
      return res.json({ session: null });
    }
    const stage = stageForEmployeeSession(session);
    const stageValidation = validateRequestedStage(req, stage);
    if (!stageValidation.ok) {
      return res.status(400).json({ error: `Session is for ${stage} stage` });
    }
    res.json({ session, stage });
  });

  router.get('/response', async (req, res) => {
    if (req.user.role !== 'employee') {
      return res.status(403).json({ error: 'Employees only' });
    }
    const session = await pulseSessionModel.getActiveSessionForOrg(req.user.organizationId, 'staff');
    if (!session) {
      return res.status(404).json({ error: 'No active Rhythm Engine session' });
    }
    const stage = stageForEmployeeSession(session);
    const stageValidation = validateRequestedStage(req, stage);
    if (!stageValidation.ok) {
      return res.status(400).json({ error: `Session is for ${stage} stage` });
    }
    await employeeResponseModel.ensureResponseRow(req.user.id, session.id);
    const row = await employeeResponseModel.getResponse(req.user.id, session.id);
    res.json({
      session,
      stage,
      copy: getSurveyCopyForAudienceFn('staff', stage),
      response: {
        currentStep: row.current_step,
        stage: row.stage || stage,
        step1: row.step1_data,
        step2: row.step2_data,
        step3: row.step3_data,
        step4: row.step4_data,
        contributionStyle: row.contribution_style,
        completedAt: row.completed_at,
        reflection:
          row.completed_at && row.contribution_style
            ? buildPersonalReflectionFn(
                row.step1_data,
                row.step2_data,
                row.step3_data,
                row.step4_data,
                computeContributionStyleFn(
                  row.step1_data,
                  row.step2_data,
                  row.step3_data,
                  row.step4_data,
                  'staff'
                )
              )
            : null,
      },
    });
  });

  router.put('/response/step/:step', async (req, res) => {
    if (req.user.role !== 'employee') {
      return res.status(403).json({ error: 'Employees only' });
    }
    const step = parseInt(req.params.step, 10);
    if (step < 1 || step > 5) {
      return res.status(400).json({ error: 'Invalid step' });
    }
    const session = await pulseSessionModel.getActiveSessionForOrg(req.user.organizationId, 'staff');
    if (!session) {
      return res.status(404).json({ error: 'No active Rhythm Engine session' });
    }
    const stage = stageForEmployeeSession(session);
    const stageValidation = validateRequestedStage(req, stage);
    if (!stageValidation.ok) {
      return res.status(400).json({ error: `Session is for ${stage} stage` });
    }

    const body = req.body || {};
    let step1 = body.step1;
    let step2 = body.step2;
    let step3 = body.step3;
    let step4 = body.step4;

    const existing = await employeeResponseModel.getResponse(req.user.id, session.id);
    if (existing) {
      step1 = step1 ?? existing.step1_data;
      step2 = step2 ?? existing.step2_data;
      step3 = step3 ?? existing.step3_data;
      step4 = step4 ?? existing.step4_data;
    }

    const row = await employeeResponseModel.upsertResponseDraft({
      userId: req.user.id,
      sessionId: session.id,
      stage,
      currentStep: step,
      step1: step1 || {},
      step2: step2 || {},
      step3: step3 || {},
      step4: step4 || {},
    });

    res.json({
      stage: row.stage || stage,
      currentStep: row.current_step,
      step1: row.step1_data,
      step2: row.step2_data,
      step3: row.step3_data,
      step4: row.step4_data,
    });
  });

  router.post('/response/complete', async (req, res) => {
    if (req.user.role !== 'employee') {
      return res.status(403).json({ error: 'Employees only' });
    }
    const session = await pulseSessionModel.getActiveSessionForOrg(req.user.organizationId, 'staff');
    if (!session) {
      return res.status(404).json({ error: 'No active Rhythm Engine session' });
    }
    const stage = stageForEmployeeSession(session);
    const stageValidation = validateRequestedStage(req, stage);
    if (!stageValidation.ok) {
      return res.status(400).json({ error: `Session is for ${stage} stage` });
    }

    const body = req.body || {};
    const existing = await employeeResponseModel.getResponse(req.user.id, session.id);
    const step1 = body.step1 ?? existing?.step1_data ?? {};
    const step2 = body.step2 ?? existing?.step2_data ?? {};
    const step3 = body.step3 ?? existing?.step3_data ?? {};
    const step4 = body.step4 ?? existing?.step4_data ?? {};

    const contribution = computeContributionStyleFn(step1, step2, step3, step4, 'staff');
    if (!contribution?.scored?.valid) {
      return res.status(400).json({
        error: 'All 16 questions are required before submission',
        unanswered: contribution?.scored?.unanswered || [],
      });
    }

    await employeeResponseModel.ensureResponseRow(req.user.id, session.id);
    const row = await employeeResponseModel.completeResponse({
      userId: req.user.id,
      sessionId: session.id,
      stage,
      step1,
      step2,
      step3,
      step4,
      contributionStyle: contribution.style,
    });

    const reflection = buildPersonalReflectionFn(step1, step2, step3, step4, contribution);
    res.json({ stage: row.stage || stage, response: row, reflection });
  });

  return router;
}

export default createEmployeeRoutes();
