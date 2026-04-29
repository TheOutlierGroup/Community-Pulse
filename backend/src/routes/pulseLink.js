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
const PULSE_SURVEY_START_DEFAULT_CONTEXT = {
  staff: 'Your answers help leaders understand what’s working and what might need attention.',
  manager: 'Your perspective as a manager helps leaders see what’s working and what might need attention.',
};

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

  function normalizePulseInviteTemplateTimepointKey(timepointPhase) {
    const raw = String(timepointPhase || '')
      .trim()
      .toLowerCase();
    if (raw === 'mid' || raw === 'during') return 'mid';
    if (raw === 'post' || raw === 'completed') return 'post';
    return 'pre';
  }

  function pulseInviteTemplateBucketByTimepoint(settingsValue, timepointPhase) {
    const normalizedTimepoint = normalizePulseInviteTemplateTimepointKey(timepointPhase);
    const templates = settingsValue && typeof settingsValue === 'object' && !Array.isArray(settingsValue)
      ? settingsValue
      : {};
    const scopedKeys = ['pre', 'mid', 'post', 'during', 'completed'];
    const hasScopedTimepoints = scopedKeys.some((key) => {
      const value = templates[key];
      return Boolean(value && typeof value === 'object' && !Array.isArray(value));
    });
    if (hasScopedTimepoints) {
      const legacyKey = normalizedTimepoint === 'mid' ? 'during' : normalizedTimepoint === 'post' ? 'completed' : null;
      const scoped = templates[normalizedTimepoint]
        || (legacyKey ? templates[legacyKey] : null);
      return scoped && typeof scoped === 'object' && !Array.isArray(scoped) ? scoped : {};
    }
    return templates;
  }

  function pulseSurveyStartFallbackTemplate(audience, stage) {
    const role = audience === 'manager' ? 'manager' : 'staff';
    const defaultCopy = getSurveyCopyForAudienceFn(role, stage);
    const intro = String(defaultCopy?.intro || '').trim();
    return {
      intro:
        intro
        || 'You’ve been invited to share a short, honest view of how work feels day to day. Most people finish in about five to ten minutes.',
      context: PULSE_SURVEY_START_DEFAULT_CONTEXT[role],
    };
  }

  function pulseSurveyStartDefaultTemplateFromSettings(settings, audience, stage) {
    const role = audience === 'manager' ? 'manager' : 'staff';
    const fallback = pulseSurveyStartFallbackTemplate(role, stage);
    const defaults = pulseInviteTemplateBucketByTimepoint(
      settings?.pulseInviteDefaultSurveyStartTemplates,
      stage
    );
    const raw = defaults && typeof defaults === 'object' ? defaults[role] : null;
    if (!raw || typeof raw !== 'object') return fallback;
    const intro = typeof raw.intro === 'string' ? raw.intro.trim() : '';
    const context = typeof raw.context === 'string' ? raw.context.trim() : '';
    return {
      intro: intro || fallback.intro,
      context: context || fallback.context,
    };
  }

  function pulseSurveyStartTemplateFromSettings(settings, audience, stage, platformSettings = null) {
    const role = audience === 'manager' ? 'manager' : 'staff';
    const fallback = pulseSurveyStartDefaultTemplateFromSettings(platformSettings, role, stage);
    const templates = pulseInviteTemplateBucketByTimepoint(settings?.pulseInviteSurveyStartTemplates, stage);
    const raw = templates && typeof templates === 'object' ? templates[role] : null;
    if (!raw || typeof raw !== 'object') return fallback;
    const intro = typeof raw.intro === 'string' ? raw.intro.trim() : '';
    const context = typeof raw.context === 'string' ? raw.context.trim() : '';
    return {
      intro: intro || fallback.intro,
      context: context || fallback.context,
    };
  }

  async function resolveSurveyCopyWithTemplate(invite, audience, stage) {
    const baseCopy = getSurveyCopyForAudienceFn(audience, stage);
    let platformSettings = null;
    if (typeof organizationModel.getFirstOrganizationByKind === 'function') {
      const platformOrg = await organizationModel.getFirstOrganizationByKind('platform');
      platformSettings = platformOrg?.settings || null;
    }
    const surveyStart = pulseSurveyStartTemplateFromSettings(
      invite?.settings || {},
      audience,
      stage,
      platformSettings
    );
    return {
      ...baseCopy,
      intro: surveyStart.intro,
      welcomeContext: surveyStart.context,
    };
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

  router.get('/themes', requirePulseLink, async (req, res) => {
    const audience = audienceForInvite(req.pulseLinkInvite);
    const stage = stageForInvite(req.pulseLinkInvite);
    if (!validateRequestedStage(req, stage)) {
      return res.status(400).json({ error: `Invite is for ${stage} stage` });
    }
    const questions = getQuestionsForAudienceFn(audience, stage);
    let copy = getSurveyCopyForAudienceFn(audience, stage);
    try {
      copy = await resolveSurveyCopyWithTemplate(req.pulseLinkOrganization, audience, stage);
    } catch (error) {
      console.error('Could not resolve survey copy template:', error);
    }
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
    const copy = await resolveSurveyCopyWithTemplate(req.pulseLinkOrganization, audience, stage);
    res.json({
      session: sessionJsonForLink(session),
      surveyAudience: audience,
      stage,
      copy,
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
    const copy = await resolveSurveyCopyWithTemplate(req.pulseLinkOrganization, audience, stage);
    res.json({
      session: sessionJsonForLink(session),
      stage,
      copy,
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
  if (body.respondentCountryCode || body.privacyNoticeVersion) {
    await pulseLinkInviteModel.updateInvitePrivacyMetadata(
      req.pulseLinkInvite.id,
      req.pulseLinkInvite.organization_id,
      {
        respondentCountryCode: body.respondentCountryCode || null,
        privacyNoticeVersion: body.privacyNoticeVersion || null,
      }
    );
  }
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
