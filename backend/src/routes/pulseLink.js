import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as Organization from '../models/Organization.js';
import * as PulseSession from '../models/PulseSession.js';
import * as PulseLinkInvite from '../models/PulseLinkInvite.js';
import * as PulseLinkResponse from '../models/PulseLinkResponse.js';
import { hashInviteToken } from '../security/inviteToken.js';
import {
  computeContributionStyle,
  buildPersonalReflection,
  getQuestionsForAudience,
  getSurveyCopyForAudience,
} from '../services/pulseEngine.js';
import { organizationHasService, CLIENT_SERVICE_PULSE } from '../services/clientServices.js';
import { internalTimepointToPulseStage, parsePulseStageFromRequest } from '../services/pulseStage.js';

const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createPulseLinkRoutes({
  organizationModel = Organization,
  pulseSessionModel = PulseSession,
  pulseLinkInviteModel = PulseLinkInvite,
  pulseLinkResponseModel = PulseLinkResponse,
  computeContributionStyleFn = computeContributionStyle,
  buildPersonalReflectionFn = buildPersonalReflection,
  getQuestionsForAudienceFn = getQuestionsForAudience,
  getSurveyCopyForAudienceFn = getSurveyCopyForAudience,
} = {}) {
  const router = Router();

  const pulseLinkLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.use(pulseLinkLimiter);

function getLinkToken(req) {
  const q = req.query?.token;
  if (typeof q === 'string' && q.trim()) return q.trim();
  const b = req.body?.token;
  if (typeof b === 'string' && b.trim()) return b.trim();
  return null;
}

  function stageForInvite(invite) {
    return internalTimepointToPulseStage(invite?.timepoint_phase);
  }

  function validateRequestedStage(req, expectedStage) {
    const requested = parsePulseStageFromRequest(req, expectedStage);
    if (requested !== expectedStage) return false;
    return true;
  }

  function pulseInviteDueDateScopeKey(invite) {
    if (!invite) return null;
    if (invite.timepoint_phase === 'pre') return 'pre';
    if (invite.timepoint_phase === 'post') return 'post';
    if (invite.timepoint_phase === 'mid') {
      const key = String(invite.timepoint_instance_key || '').trim();
      return key || null;
    }
    return null;
  }

  function pulseInviteDueDateForInvite(settings, invite) {
    const scopeKey = pulseInviteDueDateScopeKey(invite);
    if (!scopeKey) return null;
    const dueDates = settings?.pulseInviteDueDates;
    if (!dueDates || typeof dueDates !== 'object' || Array.isArray(dueDates)) return null;
    const value = String(dueDates[scopeKey] || '').trim();
    if (!ISO_DATE_ONLY_RE.test(value)) return null;
    return value;
  }

  function inviteIsPastDueDate(invite, settings) {
    const dueDate = pulseInviteDueDateForInvite(settings, invite);
    if (!dueDate) return false;
    const dueEndMs = new Date(`${dueDate}T23:59:59.999Z`).getTime();
    if (Number.isNaN(dueEndMs)) return false;
    return Date.now() > dueEndMs;
  }

  async function requirePulseLink(req, res, next) {
    try {
      const raw = getLinkToken(req);
      if (!raw) {
        return res.status(401).json({ error: 'Missing token' });
      }
      const tokenHash = hashInviteToken(raw);
      const invite = await pulseLinkInviteModel.findByTokenHash(tokenHash);
      if (!invite || !invite.token_hash) {
        return res.status(401).json({ error: 'Invalid or expired link' });
      }
      const org = await organizationModel.getOrganization(invite.organization_id);
      if (!org || org.kind !== 'client') {
        return res.status(403).json({ error: 'Invalid organization' });
      }
      if (!organizationHasService(org.settings, CLIENT_SERVICE_PULSE)) {
        return res.status(403).json({ error: 'Rhythm Engine is not available' });
      }
      if (inviteIsPastDueDate(invite, org.settings)) {
        return res.status(401).json({ error: 'Invalid or expired link' });
      }
      req.pulseLinkInvite = invite;
      req.pulseLinkOrganization = org;
      next();
    } catch (e) {
      next(e);
    }
  }

  router.get('/themes', requirePulseLink, (_req, res) => {
    const audience = audienceForInvite(_req.pulseLinkInvite);
    const stage = stageForInvite(_req.pulseLinkInvite);
    if (!validateRequestedStage(_req, stage)) {
      return res.status(400).json({ error: `Invite is for ${stage} stage` });
    }
    const questions = getQuestionsForAudienceFn(audience, stage);
    const copy = getSurveyCopyForAudienceFn(audience, stage);
    res.json({ questions, copy, stage });
  });

function audienceForInvite(invite) {
  return invite.survey_role === 'manager' ? 'manager' : 'staff';
}

/** Returning participants who skip the welcome intro still need survey_started_at set for admin status. */
function pulseResponseImpliesStarted(row) {
  if (!row || row.completed_at) return false;
  if ((row.current_step || 1) > 1) return true;
  const nonEmpty = (data) => JSON.stringify(data || {}) !== '{}';
  return (
    nonEmpty(row.step1_data) ||
    nonEmpty(row.step2_data) ||
    nonEmpty(row.step3_data) ||
    nonEmpty(row.step4_data)
  );
}

function sessionJsonForLink(session) {
  if (!session) return null;
  const purpose = session.session_purpose || 'standard';
  return {
    id: session.id,
    name: session.name,
    status: session.status,
    audience: session.audience,
    sessionPurpose: purpose,
  };
}

  router.get('/active-session', requirePulseLink, async (req, res) => {
    const audience = audienceForInvite(req.pulseLinkInvite);
    const stage = stageForInvite(req.pulseLinkInvite);
    if (!validateRequestedStage(req, stage)) {
      return res.status(400).json({ error: `Invite is for ${stage} stage` });
    }
    const session = await pulseSessionModel.resolveSessionForPulseLink(
      req.pulseLinkInvite.organization_id,
      audience,
      stage
    );
    res.json({
      session: sessionJsonForLink(session),
      surveyAudience: audience,
      stage,
      copy: getSurveyCopyForAudienceFn(audience, stage),
    });
  });

  router.get('/response', requirePulseLink, async (req, res) => {
    const audience = audienceForInvite(req.pulseLinkInvite);
    const stage = stageForInvite(req.pulseLinkInvite);
    if (!validateRequestedStage(req, stage)) {
      return res.status(400).json({ error: `Invite is for ${stage} stage` });
    }
    const session = await pulseSessionModel.resolveSessionForPulseLink(
      req.pulseLinkInvite.organization_id,
      audience,
      stage
    );
    await pulseLinkResponseModel.ensureResponseRow(req.pulseLinkInvite.id, session.id, stage);
    let row = await pulseLinkResponseModel.getResponse(req.pulseLinkInvite.id, session.id);
    if (row && !row.survey_started_at && pulseResponseImpliesStarted(row)) {
      await pulseLinkResponseModel.markSurveyStarted(req.pulseLinkInvite.id, session.id);
      row = await pulseLinkResponseModel.getResponse(req.pulseLinkInvite.id, session.id);
    }
    res.json({
      session: sessionJsonForLink(session),
      stage,
      copy: getSurveyCopyForAudienceFn(audience, stage),
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
                  audience
                )
              )
            : null,
      },
    });
  });

  router.post('/survey-started', requirePulseLink, async (req, res) => {
    const audience = audienceForInvite(req.pulseLinkInvite);
    const stage = stageForInvite(req.pulseLinkInvite);
    if (!validateRequestedStage(req, stage)) {
      return res.status(400).json({ error: `Invite is for ${stage} stage` });
    }
    const session = await pulseSessionModel.resolveSessionForPulseLink(
      req.pulseLinkInvite.organization_id,
      audience,
      stage
    );
    await pulseLinkResponseModel.ensureResponseRow(req.pulseLinkInvite.id, session.id, stage);
    const updated = await pulseLinkResponseModel.markSurveyStarted(req.pulseLinkInvite.id, session.id);
    if (!updated) {
      return res.status(500).json({ error: 'Could not record survey start' });
    }
    res.json({ ok: true });
  });

  router.put('/response/step/:step', requirePulseLink, async (req, res) => {
  const step = parseInt(req.params.step, 10);
  if (step < 1 || step > 5) {
    return res.status(400).json({ error: 'Invalid step' });
  }
  const audience = audienceForInvite(req.pulseLinkInvite);
  const stage = stageForInvite(req.pulseLinkInvite);
  if (!validateRequestedStage(req, stage)) {
    return res.status(400).json({ error: `Invite is for ${stage} stage` });
  }
  const session = await pulseSessionModel.resolveSessionForPulseLink(
    req.pulseLinkInvite.organization_id,
    audience,
    stage
  );

  const body = req.body || {};
  let step1 = body.step1;
  let step2 = body.step2;
  let step3 = body.step3;
  let step4 = body.step4;

  const existing = await pulseLinkResponseModel.getResponse(req.pulseLinkInvite.id, session.id);
  if (existing) {
    step1 = step1 ?? existing.step1_data;
    step2 = step2 ?? existing.step2_data;
    step3 = step3 ?? existing.step3_data;
    step4 = step4 ?? existing.step4_data;
  }

  const row = await pulseLinkResponseModel.upsertResponseDraft({
    inviteId: req.pulseLinkInvite.id,
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

  router.post('/response/complete', requirePulseLink, async (req, res) => {
  const audience = audienceForInvite(req.pulseLinkInvite);
  const stage = stageForInvite(req.pulseLinkInvite);
  if (!validateRequestedStage(req, stage)) {
    return res.status(400).json({ error: `Invite is for ${stage} stage` });
  }
  const session = await pulseSessionModel.resolveSessionForPulseLink(
    req.pulseLinkInvite.organization_id,
    audience,
    stage
  );

  const body = req.body || {};
  const existing = await pulseLinkResponseModel.getResponse(req.pulseLinkInvite.id, session.id);
  const step1 = body.step1 ?? existing?.step1_data ?? {};
  const step2 = body.step2 ?? existing?.step2_data ?? {};
  const step3 = body.step3 ?? existing?.step3_data ?? {};
  const step4 = body.step4 ?? existing?.step4_data ?? {};

  const contribution = computeContributionStyleFn(step1, step2, step3, step4, audience);
  if (!contribution?.scored?.valid) {
    return res.status(400).json({
      error: 'All 16 questions are required before submission',
      unanswered: contribution?.scored?.unanswered || [],
    });
  }

  await pulseLinkResponseModel.ensureResponseRow(req.pulseLinkInvite.id, session.id, stage);
  const row = await pulseLinkResponseModel.completeResponse({
    inviteId: req.pulseLinkInvite.id,
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

export default createPulseLinkRoutes();
