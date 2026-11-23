import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { ensureStorageDirs, orgLogoFilePath } from '../config/storage.js';
import { ensureOrgLogoLocal } from '../services/orgLogoStore.js';
import {
  isEventModeActive,
  respondentEventModePayload,
  WORDING_VERSION_CURRENT,
  WORDING_VERSION_EVENT,
} from '../services/eventMode.js';
import { eventStatementText, eventSurveyCopy } from '../services/eventModeWording.js';
import {
  minimumToPromise,
  smallOrgMinimumEnabled,
  STANDARD_MINIMUM,
} from '../services/confidentialityMinimum.js';
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
import { effectiveRespondentCapForSession } from '../services/assessmentMeter.js';
import { resolveBrandForOrganization, publicBrand } from '../services/licenseeBrand.js';
import {
  normalizeLegacyTemplatePlaceholders,
  DEFAULT_SURVEY_CONTACT,
} from '../services/templatePlaceholders.js';

function escapeWelcomeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
  env = process.env,
  ensureOrgLogoLocalFn = ensureOrgLogoLocal,
} = {}) {
  const router = Router();

  // Respondents at an event usually share one venue Wi-Fi address. A single
  // per-address limit of 200 requests per 15 minutes let only about 22
  // people through (each survey takes ~9 requests) before everyone else got
  // "Too many requests". The main limit is now per respondent link (hashed
  // token), with a far higher per-address ceiling kept as a backstop
  // against anyone hammering the endpoint without a token.
  const RATE_MESSAGE = { error: 'Too many requests. Please wait a few minutes and try again.' };
  const pulseLinkTokenLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: RATE_MESSAGE,
    skip: (req) => !getLinkToken(req),
    keyGenerator: (req) => `link:${hashInviteToken(getLinkToken(req))}`,
  });
  const pulseLinkAddressLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: (req) => (getLinkToken(req) ? 5000 : 200),
    standardHeaders: false,
    legacyHeaders: false,
    message: RATE_MESSAGE,
  });

  router.use(pulseLinkAddressLimiter);
  router.use(pulseLinkTokenLimiter);

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

  // POV-09: timepoint_phase on pulse_link_invites is stored as the
  // *internal* value ('pre' | 'during' | 'completed' — see the
  // pulse_link_invites_timepoint_phase_check constraint), not the external
  // stage name ('pre' | 'mid' | 'post') that pulseInviteScopeKey in
  // orgRoutes.js uses when saving a due date. Comparing invite.timepoint_phase
  // against 'post'/'mid' here never matched, so a due date set for a During
  // or Post wave was silently never enforced — the survey stayed open past
  // its configured due date. timepoint_instance_key already stores exactly
  // the scope key the write side saves under ('pre', 'post', or
  // 'session:<id>' — see inviteInstanceKeyForScope in PulseLinkInvite.js),
  // so read it directly instead of re-deriving it from the wrong field.
  function pulseInviteDueDateScopeKey(invite) {
    if (!invite) return null;
    const key = String(invite.timepoint_instance_key || '').trim();
    return key || null;
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

  function pulseSurveyStartFallbackTemplate(role) {
    const base =
      '<p>Welcome {{name}}!</p><p>Change can look many ways: from implementing a new payroll system to reorganising how a team collaborates, or even refining a single workflow to cut out unnecessary steps. As we move through this journey, it’s important that we hear from everyone; and as a manager, your perspective on how change is landing across your team is especially valuable.</p><p>There are no right or wrong answers – your honest perspective is what matters most.</p>';
    return {
      bodyHtml:
        role === 'manager'
          ? `${base}<p>As a manager, your answers about the support you receive and your capacity to lead change may be shown alongside your team’s results. Your team’s answers are only ever reported in groups of 5 or more.</p>`
          : base,
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
    const bodyHtml = typeof raw.bodyHtml === 'string' ? raw.bodyHtml.trim() : '';
    const intro = typeof raw.intro === 'string' ? raw.intro.trim() : '';
    const context = typeof raw.context === 'string' ? raw.context.trim() : '';
    return {
      bodyHtml: bodyHtml || (intro ? `<p>${intro}</p>${context ? `<p>${context}</p>` : ''}` : fallback.bodyHtml),
    };
  }

  function pulseSurveyStartTemplateFromSettings(settings, audience, stage, platformSettings = null) {
    const role = audience === 'manager' ? 'manager' : 'staff';
    const fallback = pulseSurveyStartDefaultTemplateFromSettings(platformSettings, role, stage);
    const templates = pulseInviteTemplateBucketByTimepoint(settings?.pulseInviteSurveyStartTemplates, stage);
    const raw = templates && typeof templates === 'object' ? templates[role] : null;
    if (!raw || typeof raw !== 'object') return { ...fallback, isCustom: false };
    const bodyHtml = typeof raw.bodyHtml === 'string' ? raw.bodyHtml.trim() : '';
    const intro = typeof raw.intro === 'string' ? raw.intro.trim() : '';
    const context = typeof raw.context === 'string' ? raw.context.trim() : '';
    return {
      bodyHtml: bodyHtml || (intro ? `<p>${intro}</p>${context ? `<p>${context}</p>` : ''}` : fallback.bodyHtml),
      isCustom: Boolean(bodyHtml || intro),
    };
  }

  // D-021: the welcome-template editor advertises {{name}} and {{clientname}}
  // as usable tokens (and substitutes them in the admin's own preview), but
  // nothing ever resolved them for a real respondent -- the tokens rendered
  // on the page exactly as typed, unresolved and literal. {{name}} resolves
  // to the respondent's own invite -- each public survey link is minted
  // per-recipient (see PulseLinkInvite.display_name, set from the CSV
  // import), so this is available even though the survey itself stays
  // anonymous past this point.
  // RED-066: legacy hand-typed placeholders ("<INSERT TEXT>",
  // "[NAME/EMAIL]") are removed or resolved the same way the invite email
  // resolves them, so they never reach a respondent.
  function applyWelcomeTemplatePlaceholders(bodyHtml, organization, respondentInvite) {
    const clientName = escapeWelcomeHtml(String(organization?.name || '').trim());
    const respondentName = escapeWelcomeHtml(String(respondentInvite?.display_name || '').trim() || 'there');
    const contactInfo = escapeWelcomeHtml(
      String(organization?.report_contact || '').trim() || DEFAULT_SURVEY_CONTACT
    );
    return normalizeLegacyTemplatePlaceholders(bodyHtml)
      .replace(/\{\{\s*clientname\s*\}\}/gi, clientName)
      .replace(/\{\{\s*name\s*\}\}/gi, respondentName)
      .replace(/\{\{\s*contactinfo\s*\}\}/gi, contactInfo);
  }

  // Welcome text must state the minimum group size this respondent was
  // promised. Templates written by hand say "groups of 5 or more"; when a
  // lower minimum was promised, that phrase is corrected to match.
  function applyPromisedMinimum(html, minGroup) {
    if (!html || minGroup === STANDARD_MINIMUM) return html;
    return String(html).replace(/groups of 5 or more/gi, `groups of ${minGroup} or more`);
  }

  async function resolveSurveyCopyWithTemplate(
    organization,
    audience,
    stage,
    respondentInvite = null,
    minGroup = STANDARD_MINIMUM
  ) {
    const baseCopy = getSurveyCopyForAudienceFn(audience, stage);
    let platformSettings = null;
    if (typeof organizationModel.getFirstOrganizationByKind === 'function') {
      const platformOrg = await organizationModel.getFirstOrganizationByKind('platform');
      platformSettings = platformOrg?.settings || null;
    }
    const surveyStart = pulseSurveyStartTemplateFromSettings(
      organization?.settings || {},
      audience,
      stage,
      platformSettings
    );
    const copy = {
      ...baseCopy,
      welcomeHtml: applyPromisedMinimum(
        applyWelcomeTemplatePlaceholders(surveyStart.bodyHtml, organization, respondentInvite),
        minGroup
      ),
    };
    if (!isEventModeActive(organization, env)) return copy;
    // Event mode: approved wording replaces the intro, instruction and
    // thank-you text. The client's own welcome template is still shown,
    // but only when they actually wrote one; the long built-in fallback is
    // dropped because the change context block now covers that ground.
    return {
      ...copy,
      ...eventSurveyCopy(audience, stage),
      welcomeHtml: surveyStart.isCustom ? copy.welcomeHtml : null,
      respondentName: String(respondentInvite?.display_name || '').trim() || null,
    };
  }

  // Respondents only need each statement's id and text. Internal fields
  // (theory labels, section, dimension, load flags) stay server-side (G26).
  /**
   * Records (once) and returns the minimum group size this respondent is
   * told. 5 unless an Outlier admin turned on the small-organisation
   * minimum and nobody else in this session was already told 5.
   */
  async function promisedMinimumForLink(organization, invite, session, stage) {
    if (!session || !invite) return STANDARD_MINIMUM;
    if (typeof pulseLinkResponseModel.setPromisedMinGroupSize !== 'function') return STANDARD_MINIMUM;
    const existing = await pulseLinkResponseModel.getResponse(invite.id, session.id);
    if (existing?.promised_min_group_size) return Number(existing.promised_min_group_size);
    let value = STANDARD_MINIMUM;
    if (smallOrgMinimumEnabled(organization?.settings)) {
      const sessionRows = await pulseLinkResponseModel.listResponsesForSession(session.id);
      const others = sessionRows.filter(
        (row) => String(row.invite_id) !== String(invite.id) && (row.stage || 'pre') === stage
      );
      value = minimumToPromise(organization.settings, others);
    }
    await pulseLinkResponseModel.ensureResponseRow(invite.id, session.id, stage);
    const stored = await pulseLinkResponseModel.setPromisedMinGroupSize(invite.id, session.id, value);
    return Number(stored) || value;
  }

  function questionsForLink(organization, audience, stage) {
    const overrides = isEventModeActive(organization, env) ? eventStatementText(audience, stage) || {} : {};
    return getQuestionsForAudienceFn(audience, stage).map((question) => ({
      id: question.id,
      text: overrides[question.id] || question.text,
    }));
  }

  function eventModeForLink(organization, audience, stage, minGroup = STANDARD_MINIMUM) {
    const payload = respondentEventModePayload(organization, stage, { env });
    if (!payload) return null;
    return {
      ...payload,
      hasLogo: Boolean(organization?.company_logo_filename),
      minGroupSize: minGroup,
      confidentiality:
        audience === 'manager'
          ? `**Your answers are confidential.** Your answers about the support you receive and your capacity to lead change may be shown alongside your team's results. Your team's answers are only ever reported in groups of ${minGroup} or more.`
          : `**Your individual answers are confidential and never shown to your manager.** Results are only reported for groups of ${minGroup} or more people.`,
    };
  }

  /**
   * INF-05: gracefully short-circuit a respondent when the session has hit
   * its respondent cap. Respondents who already have a completed response
   * are always allowed through (so they can re-view their reflection);
   * everyone else gets a 403 + capReached flag the public app turns into a
   * holding screen.
   */
  async function checkRespondentCapForLink({ session, organization, invite }) {
    if (!session || !invite) return { ok: true };
    const cap = await effectiveRespondentCapForSession(session, { client: organization });
    if (cap == null) return { ok: true };
    const alreadyCompleted = await pulseSessionModel.hasCompletedLinkResponseForInvite(
      invite.id,
      session.id
    );
    if (alreadyCompleted) return { ok: true };
    const counts = await pulseSessionModel.countCompletedRespondentsForSession(session.id);
    if (counts.total >= cap) {
      return {
        ok: false,
        body: {
          error:
            'This Rhythm Engine survey has reached its participant cap. Thank you for your interest — please contact your project lead.',
          capReached: true,
          respondentCap: cap,
          respondentCount: counts.total,
        },
      };
    }
    return { ok: true };
  }

  /**
   * PT-03: whether a resolved session may still take writes from a public
   * link.
   *
   * The signed-in employee routes resolve through getActiveSessionForOrg,
   * which filters `status = 'active' AND deleted_at IS NULL`. The public
   * link routes resolve through resolveSessionForPulseLink, whose first
   * lookup (getLatestSessionForOrgByPurpose) filters on neither — so a
   * closed, paused or soft-deleted session was still accepting
   * submissions here, contradicting the documented rule that closing a
   * session locks responses on both flows.
   *
   * Deliberately allows 'draft': lazy-init provisions During and Post as
   * draft (orgRoutes.js), and only one session per org/audience can be
   * 'active' at a time, so requiring 'active' would break those stages
   * outright. 'closed' and 'paused' are the states an admin explicitly
   * moved the wave into, and those are the ones that must hold.
   */
  function sessionAcceptsSubmissions(session) {
    if (!session) return false;
    if (session.deleted_at) return false;
    const status = String(session.status || '').trim().toLowerCase();
    return status !== 'closed' && status !== 'paused';
  }

  function sessionClosedResponse(session) {
    // PT-06: with allowCreate:false the public routes can now resolve to
    // no session at all, where previously one would have been created on
    // the spot. That is a distinct state from a wave an admin closed, so
    // it gets its own message rather than telling a respondent their
    // survey "closed" when it was never opened.
    if (!session) {
      return {
        error: 'There is no Rhythm Engine survey open for your organisation right now. Please check with your project lead.',
        sessionClosed: true,
        sessionStatus: 'none',
      };
    }
    const status = String(session.status || '').trim().toLowerCase();
    const message =
      status === 'paused'
        ? 'This Rhythm Engine survey is paused and is not accepting responses right now. Please check with your project lead.'
        : 'This Rhythm Engine survey has closed and is no longer accepting responses. Thank you for your interest.';
    return { error: message, sessionClosed: true, sessionStatus: status || 'unknown' };
  }

  // PT-06: the public surface never provisions. Every call in this file
  // goes through here so the flag cannot be missed on a route added later.
  function resolvePublicSession(organizationId, audience, stage) {
    return pulseSessionModel.resolveSessionForPulseLink(organizationId, audience, stage, {
      allowCreate: false,
    });
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
    const questions = questionsForLink(req.pulseLinkOrganization, audience, stage);
    let copy = getSurveyCopyForAudienceFn(audience, stage);
    try {
      copy = await resolveSurveyCopyWithTemplate(req.pulseLinkOrganization, audience, stage, req.pulseLinkInvite);
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
    const session = await resolvePublicSession(
      req.pulseLinkInvite.organization_id,
      audience,
      stage
    );
    if (!session) {
      return res.status(403).json(sessionClosedResponse(session));
    }
    const capCheck = await checkRespondentCapForLink({
      session,
      organization: req.pulseLinkOrganization,
      invite: req.pulseLinkInvite,
    });
    if (!capCheck.ok) {
      return res.status(403).json(capCheck.body);
    }
    const minGroup = await promisedMinimumForLink(req.pulseLinkOrganization, req.pulseLinkInvite, session, stage);
    const copy = await resolveSurveyCopyWithTemplate(
      req.pulseLinkOrganization,
      audience,
      stage,
      req.pulseLinkInvite,
      minGroup
    );
    let brand = null;
    try {
      // INF-06: respondents see the licensee's brand on white-labeled
      // surveys; if there's no licensee parent the frontend falls back to
      // the default (Outlier) brand.
      brand = publicBrand(await resolveBrandForOrganization(req.pulseLinkOrganization));
    } catch (error) {
      console.error('Failed to resolve brand for pulse link:', error);
    }
    res.json({
      session: sessionJsonForLink(session),
      surveyAudience: audience,
      stage,
      copy,
      brand,
      eventMode: eventModeForLink(req.pulseLinkOrganization, audience, stage, minGroup),
    });
  });

  /**
   * Event mode only: the client's own logo for the survey header. Scoped to
   * a verified respondent token (never by organisation id), so it cannot be
   * used to enumerate client logos, and it is unavailable outside Event mode
   * so switching the toggle off restores today's exposure exactly.
   */
  router.get('/logo', requirePulseLink, async (req, res) => {
    const org = req.pulseLinkOrganization;
    if (!isEventModeActive(org, env) || !org.company_logo_filename) return res.status(404).end();
    try {
      const safeName = path.basename(String(org.company_logo_filename));
      await ensureOrgLogoLocalFn(safeName);
      const full = path.resolve(orgLogoFilePath(safeName));
      const { orgLogosDir } = ensureStorageDirs();
      const rel = path.relative(path.resolve(orgLogosDir), full);
      if (rel.startsWith('..') || path.isAbsolute(rel)) return res.status(403).end();
      if (!fs.existsSync(full)) return res.status(404).end();
      const ext = path.extname(safeName).toLowerCase();
      const type =
        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : ext === '.gif' ? 'image/gif'
            : ext === '.webp' ? 'image/webp'
              : ext === '.svg' ? 'image/svg+xml'
                : 'image/png';
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (type === 'image/svg+xml') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
      return res.sendFile(full);
    } catch (error) {
      console.error('Failed to serve client logo for event mode:', error);
      return res.status(500).end();
    }
  });

  router.get('/response', requirePulseLink, async (req, res) => {
    const audience = audienceForInvite(req.pulseLinkInvite);
    const stage = stageForInvite(req.pulseLinkInvite);
    if (!validateRequestedStage(req, stage)) {
      return res.status(400).json({ error: `Invite is for ${stage} stage` });
    }
    const session = await resolvePublicSession(
      req.pulseLinkInvite.organization_id,
      audience,
      stage
    );
    if (!session) {
      return res.status(403).json(sessionClosedResponse(session));
    }
    const capCheck = await checkRespondentCapForLink({
      session,
      organization: req.pulseLinkOrganization,
      invite: req.pulseLinkInvite,
    });
    if (!capCheck.ok) {
      return res.status(403).json(capCheck.body);
    }
    await pulseLinkResponseModel.ensureResponseRow(req.pulseLinkInvite.id, session.id, stage);
    let row = await pulseLinkResponseModel.getResponse(req.pulseLinkInvite.id, session.id);
    if (row && !row.survey_started_at && pulseResponseImpliesStarted(row)) {
      await pulseLinkResponseModel.markSurveyStarted(req.pulseLinkInvite.id, session.id);
      row = await pulseLinkResponseModel.getResponse(req.pulseLinkInvite.id, session.id);
    }
    const minGroup = await promisedMinimumForLink(req.pulseLinkOrganization, req.pulseLinkInvite, session, stage);
    const copy = await resolveSurveyCopyWithTemplate(
      req.pulseLinkOrganization,
      audience,
      stage,
      req.pulseLinkInvite,
      minGroup
    );
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
    const session = await resolvePublicSession(
      req.pulseLinkInvite.organization_id,
      audience,
      stage
    );
    if (!sessionAcceptsSubmissions(session)) {
      return res.status(403).json(sessionClosedResponse(session));
    }
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
  const session = await resolvePublicSession(
    req.pulseLinkInvite.organization_id,
    audience,
    stage
  );
  if (!sessionAcceptsSubmissions(session)) {
    return res.status(403).json(sessionClosedResponse(session));
  }

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
  const session = await resolvePublicSession(
    req.pulseLinkInvite.organization_id,
    audience,
    stage
  );
  if (!sessionAcceptsSubmissions(session)) {
    return res.status(403).json(sessionClosedResponse(session));
  }
  const capCheck = await checkRespondentCapForLink({
    session,
    organization: req.pulseLinkOrganization,
    invite: req.pulseLinkInvite,
  });
  if (!capCheck.ok) {
    return res.status(403).json(capCheck.body);
  }

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
    wordingVersion: isEventModeActive(req.pulseLinkOrganization, env)
      ? WORDING_VERSION_EVENT
      : WORDING_VERSION_CURRENT,
  });

  const reflection = buildPersonalReflectionFn(step1, step2, step3, step4, contribution);
  res.json({ stage: row.stage || stage, response: row, reflection });
  });

  return router;
}

export default createPulseLinkRoutes();
