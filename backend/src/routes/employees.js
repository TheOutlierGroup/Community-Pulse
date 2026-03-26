import { Router } from 'express';
import { requireAuth, requireClientPulseService } from '../middleware/auth.js';
import * as PulseSession from '../models/PulseSession.js';
import * as EmployeeResponse from '../models/EmployeeResponse.js';
import {
  computeContributionStyle,
  buildPersonalReflection,
  THEMES,
} from '../services/pulseEngine.js';

const router = Router();

router.use(requireAuth, requireClientPulseService);

router.get('/themes', (req, res) => {
  if (req.user.role !== 'employee') {
    return res.status(403).json({ error: 'Employees only' });
  }
  res.json({ themes: THEMES });
});

router.get('/active-session', async (req, res) => {
  if (req.user.role !== 'employee') {
    return res.status(403).json({ error: 'Employees only' });
  }
  const session = await PulseSession.getActiveSessionForOrg(req.user.organizationId);
  if (!session) {
    return res.json({ session: null });
  }
  res.json({ session });
});

router.get('/response', async (req, res) => {
  if (req.user.role !== 'employee') {
    return res.status(403).json({ error: 'Employees only' });
  }
  const session = await PulseSession.getActiveSessionForOrg(req.user.organizationId);
  if (!session) {
    return res.status(404).json({ error: 'No active Pulse session' });
  }
  await EmployeeResponse.ensureResponseRow(req.user.id, session.id);
  const row = await EmployeeResponse.getResponse(req.user.id, session.id);
  res.json({
    session,
    response: {
      currentStep: row.current_step,
      step1: row.step1_data,
      step2: row.step2_data,
      step3: row.step3_data,
      step4: row.step4_data,
      contributionStyle: row.contribution_style,
      completedAt: row.completed_at,
      reflection:
        row.completed_at && row.contribution_style
          ? buildPersonalReflection(
              row.step1_data,
              row.step2_data,
              row.step3_data,
              row.step4_data,
              computeContributionStyle(
                row.step1_data,
                row.step2_data,
                row.step3_data
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
  const session = await PulseSession.getActiveSessionForOrg(req.user.organizationId);
  if (!session) {
    return res.status(404).json({ error: 'No active Pulse session' });
  }

  const body = req.body || {};
  let step1 = body.step1;
  let step2 = body.step2;
  let step3 = body.step3;
  let step4 = body.step4;

  const existing = await EmployeeResponse.getResponse(req.user.id, session.id);
  if (existing) {
    step1 = step1 ?? existing.step1_data;
    step2 = step2 ?? existing.step2_data;
    step3 = step3 ?? existing.step3_data;
    step4 = step4 ?? existing.step4_data;
  }

  const row = await EmployeeResponse.upsertResponseDraft({
    userId: req.user.id,
    sessionId: session.id,
    currentStep: step,
    step1: step1 || {},
    step2: step2 || {},
    step3: step3 || {},
    step4: step4 || {},
  });

  res.json({
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
  const session = await PulseSession.getActiveSessionForOrg(req.user.organizationId);
  if (!session) {
    return res.status(404).json({ error: 'No active Pulse session' });
  }

  const body = req.body || {};
  const existing = await EmployeeResponse.getResponse(req.user.id, session.id);
  const step1 = body.step1 ?? existing?.step1_data ?? {};
  const step2 = body.step2 ?? existing?.step2_data ?? {};
  const step3 = body.step3 ?? existing?.step3_data ?? {};
  const step4 = body.step4 ?? existing?.step4_data ?? {};

  const { style } = computeContributionStyle(step1, step2, step3);

  await EmployeeResponse.ensureResponseRow(req.user.id, session.id);
  const row = await EmployeeResponse.completeResponse({
    userId: req.user.id,
    sessionId: session.id,
    step1,
    step2,
    step3,
    step4,
    contributionStyle: style,
  });

  const contribution = computeContributionStyle(step1, step2, step3);
  const reflection = buildPersonalReflection(
    step1,
    step2,
    step3,
    step4,
    contribution
  );
  res.json({ response: row, reflection });
});

export default router;
