import fs from 'fs';
import { randomBytes, randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { requireBodyFields } from '../../middleware/validation.js';
import { extensionForUpload } from '../../middleware/avatarUpload.js';
import { avatarFilePath, orgLogoFilePath } from '../../config/storage.js';
import * as Organization from '../../models/Organization.js';
import * as User from '../../models/User.js';
import * as Invite from '../../models/Invite.js';
import * as PasswordResetToken from '../../models/PasswordResetToken.js';
import * as PulseSession from '../../models/PulseSession.js';
import * as PulseLinkInvite from '../../models/PulseLinkInvite.js';
import * as PulseLinkResponse from '../../models/PulseLinkResponse.js';
import * as PlatformUserClientAssignment from '../../models/PlatformUserClientAssignment.js';
import {
  isResendConfigured,
  getPulseInviteDefaultTemplate,
  sendPlatformWelcomeEmail,
  sendPulseInviteEmail,
} from '../../services/email.js';
import {
  classifyQuadrant,
  classifySponsorshipChainState,
  DIMENSIONS,
  READINESS_THRESHOLD,
  scoreBandForSponsorshipLoad,
  scoreResponseFromSteps,
  SPONSORSHIP_LOAD_BAND_DEFAULTS,
  SPONSORSHIP_SUBSCORE_DEFAULT_THRESHOLD,
} from '../../services/pulseEngine.js';
import {
  assertClientOrganizationPlatformForUser,
  assertClientUserInOrg,
  handleOrgLogoPlatformUpload,
  handlePlatformUserCreateUpload,
  normalizeServiceIds,
  publicPulseSessionRow,
  publicStaffUser,
  sendAvatarFileOr404,
  sendOrgLogoFileOr404,
} from './shared.js';
import {
  filterRowsForManagerScope,
  parseManagerIdsFromQuery,
  parseQueryBool,
} from '../../services/pulseDashboardScope.js';
import {
  buildDimensionFloorAlerts,
  buildSponsorshipSectionSignals,
  buildSponsorshipDecliningAlert,
  buildTeamOutlierAlerts,
  buildThresholdCrossingAlerts,
  calculateLargestRemainderPercentages,
  headlineForVerdict,
  prioritizeAndCapAlerts,
  verdictForScores,
} from '../../services/pulseDashboardMetrics.js';
import { schedulePulseAlertNotifications } from '../../services/pulseAlertNotifications.js';
import { listSessionResponses } from '../../services/pulseDataContract.js';
import { generatePulseSoWhatSummary } from '../../services/pulseSoWhatSummary.js';
import {
  normalizeInviteImportRecipients,
  validateInviteImportRows,
} from '../../services/pulseInviteImportValidation.js';
import { collectStaffInvitesNeedingManagerRole } from '../../services/pulseLinkRoleRepair.js';
import {
  internalTimepointToPulseStage,
  normalizePulseStage,
  pulseStageToInternalTimepoint,
} from '../../services/pulseStage.js';
import { createPulseHandoffToken } from '../../security/pulseHandoffToken.js';
import {
  CLIENT_SERVICE_PULSE,
  clientServiceCatalogFromPlatformSettings,
  normalizeClientServiceCatalog,
  organizationHasService,
} from '../../services/clientServices.js';

function parsePagination(query) {
  const rawLimit = Number.parseInt(String(query?.limit ?? ''), 10);
  const rawOffset = Number.parseInt(String(query?.offset ?? ''), 10);
  return {
    limit: Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 200,
    offset: Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0,
  };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function ratio(numerator, denominator) {
  if (!denominator || denominator <= 0) return 0;
  return numerator / denominator;
}

function responseScoresOutOf40(row) {
  const audience = row?.role === 'admin' ? 'manager' : 'staff';
  return scoreResponseFromSteps(
    row?.step1_data,
    row?.step2_data,
    row?.step3_data,
    row?.step4_data,
    audience,
    row?.stage || 'pre'
  );
}

function quadrantLabel(adoption, sponsorship) {
  return classifyQuadrant(adoption, sponsorship).label;
}

function scoreDelta(current, previous) {
  if (current == null || previous == null) return null;
  return round1(current - previous);
}

function sponsorshipConfigFromOrgSettings(settings) {
  const source =
    settings?.sponsorshipAnalysisConfig && typeof settings.sponsorshipAnalysisConfig === 'object'
      ? settings.sponsorshipAnalysisConfig
      : {};
  const receivedThreshold = Number(source.receivedThreshold ?? SPONSORSHIP_SUBSCORE_DEFAULT_THRESHOLD);
  const capacityThreshold = Number(source.capacityThreshold ?? SPONSORSHIP_SUBSCORE_DEFAULT_THRESHOLD);
  const boundaries =
    source.loadBandBoundaries && typeof source.loadBandBoundaries === 'object'
      ? source.loadBandBoundaries
      : {};
  const loadBandBoundaries = {
    sustainableMin: Number(boundaries.sustainableMin ?? SPONSORSHIP_LOAD_BAND_DEFAULTS.sustainableMin),
    stretchedMin: Number(boundaries.stretchedMin ?? SPONSORSHIP_LOAD_BAND_DEFAULTS.stretchedMin),
    atCapacityMin: Number(boundaries.atCapacityMin ?? SPONSORSHIP_LOAD_BAND_DEFAULTS.atCapacityMin),
  };
  const teamTableDisplayLimit = Number(source.teamTableDisplayLimit ?? 5);
  const aiSignalsEnabled = source.aiSignalsEnabled !== false;
  return {
    receivedThreshold,
    capacityThreshold,
    loadBandBoundaries,
    teamTableDisplayLimit:
      Number.isInteger(teamTableDisplayLimit) && teamTableDisplayLimit > 0
        ? teamTableDisplayLimit
        : 5,
    aiSignalsEnabled,
  };
}

function sponsorshipLoadBandOrder() {
  return ['Sustainable', 'Stretched', 'At Capacity', 'Overloaded'];
}

function sponsorshipChainStateOrder() {
  return [
    'Chain Functioning',
    'Breaking at Manager Level',
    'Managers Resilient, Under-Supported',
    'Sponsorship Failed at Both Levels',
  ];
}

function chainSeverityRank(chainState) {
  if (chainState === 'Sponsorship Failed at Both Levels') return 4;
  if (chainState === 'Managers Resilient, Under-Supported') return 3;
  if (chainState === 'Breaking at Manager Level') return 2;
  return 1;
}

function loadSeverityRank(loadBand) {
  if (loadBand === 'Overloaded') return 4;
  if (loadBand === 'At Capacity') return 3;
  if (loadBand === 'Stretched') return 2;
  return 1;
}

function pulseSessionTimepointKind(session) {
  const purpose = String(session?.session_purpose || '')
    .trim()
    .toLowerCase();
  if (purpose === 'pre_project') return 'pre';
  if (purpose === 'completed_project') return 'completed';
  if (purpose === 'link_invite') return null;
  return 'during';
}

function pulseSessionDateKey(session) {
  const createdAt = session?.created_at;
  if (!createdAt) return '';
  const dt = new Date(createdAt);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

function parsePulseDashboardTimepoint(value) {
  if (value == null || value === '') return null;
  const canonical = normalizePulseStage(value, null);
  if (!canonical) return null;
  return pulseStageToInternalTimepoint(canonical);
}

function parsePulseInviteTimepoint(value) {
  return pulseStageToInternalTimepoint(normalizePulseStage(value));
}

function parsePulseInviteDuringSessionId(value) {
  const raw = String(value || '').trim();
  return raw || null;
}

function validatePulseInviteDuringSession(timepointPhase, duringSessionId) {
  if (timepointPhase !== 'mid') return null;
  if (duringSessionId) return null;
  return 'duringSessionId is required when timepoint is during';
}

function testLikertFromBand(seed, offset, band = 'mid') {
  const base = Math.sin((seed + 1) * 127.1 + (offset + 1) * 311.7) * 10000;
  const unit = base - Math.floor(base);
  if (band === 'high') return unit < 0.5 ? 4 : 5;
  if (band === 'low') return unit < 0.5 ? 1 : 2;
  if (band === 'high-mid') return unit < 0.33 ? 3 : unit < 0.66 ? 4 : 5;
  if (band === 'low-mid') return unit < 0.33 ? 1 : unit < 0.66 ? 2 : 3;
  return unit < 0.25 ? 2 : unit < 0.75 ? 3 : 4;
}

function buildTestSurveyStepAnswers(surveyRole, seed = 0) {
  const prefix = surveyRole === 'manager' ? 'MQ' : 'Q';
  const profileCycle = surveyRole === 'manager'
    ? ['balanced', 'high-risk', 'manager-pressure', 'managers-resilient', 'chain-functioning']
    : ['balanced', 'high-risk', 'motivated-lost', 'capable-wary', 'optimal'];
  const profile = profileCycle[seed % profileCycle.length];
  const adoptionBandByProfile = {
    balanced: 'mid',
    'high-risk': 'low',
    'motivated-lost': 'high',
    'capable-wary': 'low',
    optimal: 'high',
    'manager-pressure': 'low-mid',
    'managers-resilient': 'high',
    'chain-functioning': 'high',
  };
  const sponsorshipBandByProfile = {
    balanced: 'mid',
    'high-risk': 'low',
    'motivated-lost': 'low',
    'capable-wary': 'high',
    optimal: 'high',
    'manager-pressure': 'low-mid',
    'managers-resilient': 'low-mid',
    'chain-functioning': 'high',
  };
  const answers = {};
  for (let i = 1; i <= 16; i += 1) {
    const isAdoption = i <= 8;
    const band = isAdoption
      ? adoptionBandByProfile[profile] || 'mid'
      : sponsorshipBandByProfile[profile] || 'mid';
    answers[`${prefix}${i}`] = testLikertFromBand(seed, i, band);
  }

  if (surveyRole === 'manager') {
    // Manager load-sensitive questions (MQ5, MQ6, MQ15, MQ16) need spread to exercise load reports.
    if (profile === 'manager-pressure') {
      answers.MQ5 = testLikertFromBand(seed, 105, 'low');
      answers.MQ6 = testLikertFromBand(seed, 106, 'low');
      answers.MQ15 = testLikertFromBand(seed, 115, 'low');
      answers.MQ16 = testLikertFromBand(seed, 116, 'low-mid');
    } else if (profile === 'managers-resilient') {
      answers.MQ5 = testLikertFromBand(seed, 205, 'high');
      answers.MQ6 = testLikertFromBand(seed, 206, 'high-mid');
      answers.MQ15 = testLikertFromBand(seed, 215, 'high');
      answers.MQ16 = testLikertFromBand(seed, 216, 'high-mid');
    }
  }
  return { answers };
}

function normalizeGroupCountInput(rawCount) {
  const parsed = Number.parseInt(String(rawCount ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 100);
}

function buildTestGroupValues(groupLabels, groupCounts, index) {
  return groupLabels.map((label, groupIndex) => {
    const distinctCount = normalizeGroupCountInput(groupCounts?.[groupIndex]);
    if (distinctCount <= 0) return null;
    const bucket = (index % distinctCount) + 1;
    return `${label} ${bucket}`;
  });
}

function buildTestRecipients({ managerCount, staffCount, groupLabels, groupCounts, datasetToken }) {
  const recipients = [];
  const managerEmails = [];
  let absoluteIndex = 0;

  for (let i = 0; i < managerCount; i += 1) {
    const email = `test-manager-${datasetToken}-${i + 1}@example.com`;
    managerEmails.push(email);
    recipients.push({
      name: `Test Manager ${i + 1}`,
      email,
      role: 'manager',
      managerId: email,
      groupValues: buildTestGroupValues(groupLabels, groupCounts, absoluteIndex),
    });
    absoluteIndex += 1;
  }

  for (let i = 0; i < staffCount; i += 1) {
    const managerEmail = managerEmails[i % managerEmails.length];
    recipients.push({
      name: `Test Staff ${i + 1}`,
      email: `test-staff-${datasetToken}-${i + 1}@example.com`,
      role: 'staff',
      managerId: managerEmail,
      groupValues: buildTestGroupValues(groupLabels, groupCounts, absoluteIndex),
    });
    absoluteIndex += 1;
  }

  return recipients;
}

async function upsertPulseInviteRecipients({
  organizationId,
  timepointPhase,
  duringSessionId,
  recipients,
  allowUnassignedStaff,
  expectedGroupLevelLabels,
}) {
  const existingInvites = await PulseLinkInvite.listInviteRowsForOrg(organizationId, {
    timepointPhase,
    duringSessionId,
  });
  const invitesById = new Map(existingInvites.map((row) => [row.id, row]));
  const normalizedRows = normalizeInviteImportRecipients(recipients);
  const prevalidation = validateInviteImportRows(normalizedRows, invitesById, {
    allowStaffWithoutManagerRef: allowUnassignedStaff,
    expectedGroupLevels: expectedGroupLevelLabels.length,
  });
  const errors = [...prevalidation.errors];
  const invalidIndices = new Set(prevalidation.invalidIndices);

  const upsertedRows = [];
  for (const row of normalizedRows) {
    if (invalidIndices.has(row.index)) continue;
    const { row: upsertedRow, error } = await PulseLinkInvite.upsertInviteRow({
      organizationId,
      timepointPhase,
      duringSessionId,
      displayName: row.displayName,
      email: row.email,
      surveyRole: row.surveyRole,
      managerInviteId: null,
      groupLevelValues: row.groupValues,
    });
    if (error || !upsertedRow) {
      errors.push({ index: row.index, email: row.email, error: error || 'invalid' });
      invalidIndices.add(row.index);
      continue;
    }
    upsertedRows.push({ source: row, invite: upsertedRow });
    invitesById.set(upsertedRow.id, upsertedRow);
  }

  const managerRefToInviteId = new Map();
  for (const item of upsertedRows) {
    if (item.source.surveyRole === 'manager' && item.source.managerRef) {
      managerRefToInviteId.set(item.source.managerRef, item.invite.id);
    }
  }

  for (const item of upsertedRows) {
    const { source, invite } = item;
    if (source.surveyRole !== 'staff') {
      await PulseLinkInvite.updateManagerInviteId(invite.id, organizationId, null, {
        timepointPhase,
        duringSessionId,
      });
      continue;
    }
    let resolvedManagerId = null;
    if (source.managerInviteId) {
      resolvedManagerId = source.managerInviteId;
    } else if (source.managerRef) {
      resolvedManagerId = managerRefToInviteId.get(source.managerRef) || null;
    }
    if (!resolvedManagerId) {
      if (allowUnassignedStaff) {
        await PulseLinkInvite.updateManagerInviteId(invite.id, organizationId, null, {
          timepointPhase,
          duringSessionId,
        });
        continue;
      }
      errors.push({
        index: source.index,
        email: source.email,
        error: 'manager_not_found',
      });
      continue;
    }
    if (resolvedManagerId === invite.id) {
      errors.push({
        index: source.index,
        email: source.email,
        error: 'self_manager_not_allowed',
      });
      continue;
    }
    const resolvedManagerRow = invitesById.get(resolvedManagerId)
      || (await PulseLinkInvite.getInviteInOrg(resolvedManagerId, organizationId, {
        timepointPhase,
        duringSessionId,
      }));
    if (!resolvedManagerRow || resolvedManagerRow.survey_role !== 'manager') {
      errors.push({
        index: source.index,
        email: source.email,
        error: 'invalid_manager_invite',
      });
      continue;
    }
    const updated = await PulseLinkInvite.updateManagerInviteId(invite.id, organizationId, resolvedManagerId, {
      timepointPhase,
      duringSessionId,
    });
    if (!updated) {
      errors.push({
        index: source.index,
        email: source.email,
        error: 'manager_assignment_failed',
      });
    }
  }

  return {
    upsertedRows,
    upserted: upsertedRows.length,
    errorCount: errors.length,
    errors: errors.slice(0, 50),
  };
}

function createDuringPulseCheckpointName(now = new Date()) {
  return `During checkpoint · ${now.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })}`;
}

async function createFreshActiveDuringSession(organizationId, name, audience) {
  const current = await PulseSession.getActiveSessionForOrg(organizationId, audience);
  if (current) {
    await PulseSession.updateSessionStatus(current.id, organizationId, 'closed');
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await PulseSession.createSession(organizationId, name, 'active', audience, 'during_project');
    } catch (error) {
      // Another concurrent request may have created the active session first.
      if (error?.code !== '23505') throw error;
      const concurrent = await PulseSession.getActiveSessionForOrg(organizationId, audience);
      if (concurrent) return concurrent;
      if (attempt === 1) throw error;
    }
  }
  throw new Error('Could not create active during-project session');
}

async function listMergedResponsesForSession(sessionId, stage = null) {
  const { rows } = await listSessionResponses(sessionId, { stage });
  return rows;
}

function firstFrontendOrigin() {
  return String(process.env.FRONTEND_ORIGIN || '').split(',')[0].trim();
}

function resolveCrmAppBaseUrl() {
  const raw = process.env.CRM_APP_URL || process.env.APP_URL || firstFrontendOrigin();
  return raw ? raw.replace(/\/$/, '') : '';
}

function resolvePublicAppBaseUrl() {
  const raw = process.env.PULSE_APP_URL || process.env.APP_URL || firstFrontendOrigin();
  return raw ? raw.replace(/\/$/, '') : '';
}

function resolvePulseAppBaseUrl() {
  const raw = process.env.PULSE_APP_URL || resolvePublicAppBaseUrl();
  return raw ? raw.replace(/\/$/, '') : '';
}

const CLIENT_FIRST_ADMIN_WELCOME_RESET_MS = 7 * 24 * 60 * 60 * 1000;
const CLIENT_STATUSES = new Set([
  'client-current',
  'client-previous',
  'prospect-warm',
  'prospect-cold',
  'prospect-lost',
  'prospect-new',
  'prospect-active-campaign',
  'do-not-call-contact-blocked',
]);
const CLIENT_STATUS_LEGACY_MAP = new Map([
  ['lead', 'prospect-new'],
  ['active', 'client-current'],
  ['inactive', 'client-previous'],
  ['closed', 'do-not-call-contact-blocked'],
]);
const PULSE_INVITE_TEMPLATE_AUDIENCES = new Set(['staff', 'manager']);
const PULSE_INVITE_TEMPLATE_MAX_SUBJECT_LENGTH = 200;
const PULSE_INVITE_TEMPLATE_MAX_BODY_LENGTH = 20000;
const PULSE_INVITE_TEMPLATE_PLACEHOLDERS = ['{{name}}', '{{link}}'];

function pulseInviteDefaultTemplateFromSettings(settings, audience, organizationName) {
  const role = audience === 'manager' ? 'manager' : 'staff';
  const fallback = getPulseInviteDefaultTemplate(role, organizationName);
  const defaults = settings?.pulseInviteDefaultEmailTemplates;
  const raw = defaults && typeof defaults === 'object' ? defaults[role] : null;
  if (!raw || typeof raw !== 'object') return fallback;
  const subject = typeof raw.subject === 'string' ? raw.subject.trim() : '';
  const bodyHtml = typeof raw.bodyHtml === 'string' ? raw.bodyHtml.trim() : '';
  return {
    subject: subject || fallback.subject,
    bodyHtml: bodyHtml || fallback.bodyHtml,
  };
}

function pulseInviteTemplateFromSettings(settings, audience, organizationName, platformSettings = null) {
  const role = audience === 'manager' ? 'manager' : 'staff';
  const fallback = pulseInviteDefaultTemplateFromSettings(platformSettings, role, organizationName);
  const templates = settings?.pulseInviteEmailTemplates;
  const raw = templates && typeof templates === 'object' ? templates[role] : null;
  if (!raw || typeof raw !== 'object') return fallback;
  const subject = typeof raw.subject === 'string' ? raw.subject.trim() : '';
  const bodyHtml = typeof raw.bodyHtml === 'string' ? raw.bodyHtml.trim() : '';
  return {
    subject: subject || fallback.subject,
    bodyHtml: bodyHtml || fallback.bodyHtml,
  };
}

function pulseInviteTemplatesPayload(org, platformSettings = null) {
  return {
    staff: pulseInviteTemplateFromSettings(org?.settings, 'staff', org?.name, platformSettings),
    manager: pulseInviteTemplateFromSettings(org?.settings, 'manager', org?.name, platformSettings),
  };
}

function pulseInviteDefaultTemplatesPayload(platformOrg) {
  return {
    staff: pulseInviteDefaultTemplateFromSettings(platformOrg?.settings, 'staff', platformOrg?.name),
    manager: pulseInviteDefaultTemplateFromSettings(platformOrg?.settings, 'manager', platformOrg?.name),
  };
}

function parseMultipartBool(v) {
  if (v === true || v === 'true' || v === '1') return true;
  if (v === false || v === 'false' || v === '0') return false;
  return false;
}

function parseTruthyQueryBool(v) {
  if (v == null) return false;
  const normalized = String(v).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function normalizeClientStatus(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  const status = CLIENT_STATUS_LEGACY_MAP.get(raw) || raw;
  if (!CLIENT_STATUSES.has(status)) return null;
  return status;
}

function csvEscape(value) {
  const source = String(value ?? '');
  if (!/[",\n]/.test(source)) return source;
  return `"${source.replace(/"/g, '""')}"`;
}

function buildClientUserImportTemplateCsv(groupLevelLabels) {
  const fixedHeaders = [
    'employee preferred first name',
    'email address',
    'employent type (FT/PT/Casual)',
    'Manager (Yes/No)',
    'Manager Name',
    'birth year',
    'Length of Service',
    'Primary Work Location',
  ];
  const dynamicHeaders = (Array.isArray(groupLevelLabels) ? groupLevelLabels : [])
    .map((label) => String(label ?? '').trim())
    .filter(Boolean);
  const headerLine = [...fixedHeaders, ...dynamicHeaders].map(csvEscape).join(',');
  return `${headerLine}\n`;
}

function normalizedGroupLevelLabelsFromSettings(settings) {
  return (Array.isArray(settings?.groupLevelLabels) ? settings.groupLevelLabels : [])
    .map((label) => String(label ?? '').trim())
    .filter(Boolean)
    .slice(0, 5);
}

export function registerPlatformOrgRoutes(router) {
  const requirePlatformAdminRole = (req, res, next) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    next();
  };

  router.get('/organizations', async (req, res) => {
    if (req.user?.role === 'admin') {
      const rows = await Organization.listOrganizationsByKind('client', parsePagination(req.query));
      return res.json({ organizations: rows });
    }
    const assignedOrgIds = await PlatformUserClientAssignment.listAssignedClientOrgIdsForUser(req.user.id);
    if (!assignedOrgIds.length) return res.json({ organizations: [] });
    const rows = await Organization.listClientOrganizationsByIds(assignedOrgIds, parsePagination(req.query));
    res.json({ organizations: rows });
  });

  router.get('/service-catalog', requirePlatformAdminRole, async (req, res) => {
    const platformOrg = await Organization.getOrganization(req.user.organizationId);
    if (!platformOrg || platformOrg.kind !== 'platform') {
      return res.status(404).json({ error: 'Platform organization not found' });
    }
    return res.json({
      services: clientServiceCatalogFromPlatformSettings(platformOrg.settings),
    });
  });

  router.patch('/service-catalog', requirePlatformAdminRole, async (req, res) => {
    const body = req.body || {};
    if (!Object.prototype.hasOwnProperty.call(body, 'services')) {
      return res.status(400).json({ error: 'services is required' });
    }
    if (!Array.isArray(body.services)) {
      return res.status(400).json({ error: 'services must be an array' });
    }
    const nextCatalog = normalizeClientServiceCatalog(body.services, { fallbackToDefaults: false });
    const updated = await Organization.updateOrganizationSettings(req.user.organizationId, {
      serviceCatalog: nextCatalog,
    });
    if (!updated || updated.kind !== 'platform') {
      return res.status(404).json({ error: 'Platform organization not found' });
    }
    return res.json({ services: nextCatalog });
  });

  router.get('/pulse-link-invites/default-templates', requirePlatformAdminRole, async (req, res) => {
    const platformOrg = await Organization.getOrganization(req.user.organizationId);
    if (!platformOrg || platformOrg.kind !== 'platform') {
      return res.status(404).json({ error: 'Platform organization not found' });
    }
    return res.json({
      templates: pulseInviteDefaultTemplatesPayload(platformOrg),
      placeholders: PULSE_INVITE_TEMPLATE_PLACEHOLDERS,
    });
  });

  router.put('/pulse-link-invites/default-templates', requirePlatformAdminRole, async (req, res) => {
    const platformOrg = await Organization.getOrganization(req.user.organizationId);
    if (!platformOrg || platformOrg.kind !== 'platform') {
      return res.status(404).json({ error: 'Platform organization not found' });
    }
    const audience = String(req.body?.audience || '')
      .trim()
      .toLowerCase();
    if (!PULSE_INVITE_TEMPLATE_AUDIENCES.has(audience)) {
      return res.status(400).json({ error: 'audience must be staff or manager' });
    }
    const subject = String(req.body?.subject || '').trim();
    if (!subject) return res.status(400).json({ error: 'subject is required' });
    if (subject.length > PULSE_INVITE_TEMPLATE_MAX_SUBJECT_LENGTH) {
      return res.status(400).json({
        error: `subject must be ${PULSE_INVITE_TEMPLATE_MAX_SUBJECT_LENGTH} characters or less`,
      });
    }
    const bodyHtml = String(req.body?.bodyHtml || '').trim();
    if (!bodyHtml) return res.status(400).json({ error: 'bodyHtml is required' });
    if (bodyHtml.length > PULSE_INVITE_TEMPLATE_MAX_BODY_LENGTH) {
      return res.status(400).json({
        error: `bodyHtml is too long (max ${PULSE_INVITE_TEMPLATE_MAX_BODY_LENGTH} chars)`,
      });
    }
    const existingDefaults =
      platformOrg.settings?.pulseInviteDefaultEmailTemplates &&
      typeof platformOrg.settings.pulseInviteDefaultEmailTemplates === 'object'
        ? platformOrg.settings.pulseInviteDefaultEmailTemplates
        : {};
    const updated = await Organization.updateOrganizationSettings(platformOrg.id, {
      pulseInviteDefaultEmailTemplates: {
        ...existingDefaults,
        [audience]: {
          subject,
          bodyHtml,
          updatedAt: new Date().toISOString(),
          updatedByUserId: req.user.id,
        },
      },
    });
    if (!updated || updated.kind !== 'platform') {
      return res.status(404).json({ error: 'Platform organization not found' });
    }
    return res.json({
      templates: pulseInviteDefaultTemplatesPayload(updated),
      placeholders: PULSE_INVITE_TEMPLATE_PLACEHOLDERS,
    });
  });

  router.post('/organizations', requirePlatformAdminRole, handleOrgLogoPlatformUpload, async (req, res) => {
    const name = req.body.name;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const adminEmail = req.body.adminEmail;
    const addrRaw = req.body.companyAddress ?? req.body.address;
    const initialSettings = {};
    if (addrRaw != null && String(addrRaw).trim()) {
      initialSettings.companyAddress = String(addrRaw).trim();
    }
    let org = await Organization.createOrganization(name.trim(), initialSettings, 'client');
    if (req.file) {
      const ext = extensionForUpload(req.file);
      const base = `org-${org.id}${ext || '.png'}`;
      try {
        await fs.promises.writeFile(orgLogoFilePath(base), req.file.buffer);
        const updated = await Organization.setCompanyLogoFilename(org.id, base);
        if (updated) org = updated;
      } catch (e) {
        console.error(e);
      }
    }
    if (adminEmail && String(adminEmail).trim()) {
      const existing = await User.findUserByEmail(adminEmail);
      if (existing) {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }
      let sendWelcomeEmail = parseMultipartBool(req.body.sendWelcomeEmail);
      let enableLogin = parseMultipartBool(req.body.enableLogin);
      if (sendWelcomeEmail) {
        enableLogin = true;
      }
      const passwordHash = await bcrypt.hash(randomBytes(32).toString('base64url'), 12);
      const adminFirstName = req.body.adminFirstName;
      const adminLastName = req.body.adminLastName;
      const row = await User.createUserWithProfile({
        email: String(adminEmail).trim(),
        passwordHash,
        role: 'admin',
        organizationId: org.id,
        firstName: adminFirstName,
        lastName: adminLastName,
        loginEnabled: enableLogin,
      });
      let outRow = await User.findUserById(row.id);
      let welcomeEmailSent = false;
      if (sendWelcomeEmail) {
        const baseUrl = resolveCrmAppBaseUrl();
        if (baseUrl && isResendConfigured()) {
          try {
            const resetToken = await PasswordResetToken.createResetToken(row.id, {
              expiresInMs: CLIENT_FIRST_ADMIN_WELCOME_RESET_MS,
            });
            const loginUrl = `${baseUrl}/login`;
            const setPasswordUrl = `${baseUrl}/reset-password/${resetToken}`;
            const displayName = [adminFirstName, adminLastName]
              .map((s) => String(s || '').trim())
              .filter(Boolean)
              .join(' ');
            await sendPlatformWelcomeEmail(
              String(adminEmail).trim(),
              displayName,
              loginUrl,
              setPasswordUrl,
              org.name
            );
            welcomeEmailSent = true;
          } catch (e) {
            console.error('Client first admin welcome email failed:', e);
          }
        }
      }
      return res.status(201).json({
        organization: org,
        firstUser: publicStaffUser(outRow),
        welcomeEmailRequested: sendWelcomeEmail,
        welcomeEmailSent,
      });
    }
    res.status(201).json({ organization: org });
  });

  router.patch('/organizations/:id', requirePlatformAdminRole, async (req, res) => {
    const { name, settings, clientStatus } = req.body;
    if (name === undefined && settings === undefined && clientStatus === undefined) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    let normalizedClientStatus;
    if (clientStatus !== undefined) {
      normalizedClientStatus = normalizeClientStatus(clientStatus);
      if (!normalizedClientStatus) {
        return res.status(400).json({
          error:
            'clientStatus must be one of: client-current, client-previous, prospect-warm, prospect-cold, prospect-lost, prospect-new, prospect-active-campaign, do-not-call-contact-blocked',
        });
      }
    }
    let settingsPatch = settings;
    if (settings !== undefined) {
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return res.status(400).json({ error: 'settings must be an object' });
      }
      settingsPatch = { ...settings };
      if (Object.prototype.hasOwnProperty.call(settingsPatch, 'groupLevels')) {
        if (settingsPatch.groupLevels == null || settingsPatch.groupLevels === '') {
          settingsPatch.groupLevels = null;
        } else {
          const parsed = Number.parseInt(String(settingsPatch.groupLevels), 10);
          if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
            return res.status(400).json({ error: 'settings.groupLevels must be an integer from 1 to 5' });
          }
          settingsPatch.groupLevels = parsed;
        }
      }
      if (Object.prototype.hasOwnProperty.call(settingsPatch, 'groupLevelLabels')) {
        if (settingsPatch.groupLevelLabels == null || settingsPatch.groupLevelLabels === '') {
          settingsPatch.groupLevelLabels = null;
        } else if (!Array.isArray(settingsPatch.groupLevelLabels)) {
          return res.status(400).json({ error: 'settings.groupLevelLabels must be an array' });
        } else {
          const labels = settingsPatch.groupLevelLabels
            .slice(0, 5)
            .map((label) => String(label ?? '').trim());
          if (labels.length === 0 || labels.some((label) => !label)) {
            return res.status(400).json({ error: 'settings.groupLevelLabels must contain 1-5 non-empty labels' });
          }
          settingsPatch.groupLevelLabels = labels;
        }
      }
      if (
        settingsPatch.groupLevels != null &&
        Array.isArray(settingsPatch.groupLevelLabels) &&
        settingsPatch.groupLevelLabels.length !== settingsPatch.groupLevels
      ) {
        return res.status(400).json({ error: 'settings.groupLevelLabels length must match settings.groupLevels' });
      }
      if (Object.prototype.hasOwnProperty.call(settingsPatch, 'services')) {
        const platformOrg = await Organization.getOrganization(req.user.organizationId);
        const catalog = clientServiceCatalogFromPlatformSettings(platformOrg?.settings);
        const allowedServiceIds = new Set(catalog.map((service) => service.id));
        const normalized = normalizeServiceIds(settingsPatch.services, allowedServiceIds);
        if (normalized == null) {
          return res.status(400).json({ error: 'settings.services must be an array' });
        }
        settingsPatch.services = normalized;
        if (Object.prototype.hasOwnProperty.call(settingsPatch, 'pulseEnabled')) {
          delete settingsPatch.pulseEnabled;
        }
      }
    }
    const updated = await Organization.updateOrganizationClient(req.params.id, {
      name,
      settings: settingsPatch,
      clientStatus: normalizedClientStatus,
    });
    if (!updated) return res.status(404).json({ error: 'Organization not found' });
    res.json(updated);
  });

  router.get('/organizations/:id/users', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    const role = req.query.role;
    const users = await User.listUsersForOrg(req.params.id, {
      role: role === 'admin' || role === 'employee' ? role : undefined,
      ...parsePagination(req.query),
    });
    res.json({ users: users.map(publicStaffUser) });
  });

  router.patch('/organizations/:id/users/:userId', async (req, res) => {
    const orgId = req.params.id;
    const { userId } = req.params;
    const target = await assertClientUserInOrg(orgId, userId, req.user);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const body = req.body || {};
    const patch = {};
    if ('firstName' in body) patch.firstName = body.firstName;
    if ('lastName' in body) patch.lastName = body.lastName;
    if ('email' in body) patch.email = body.email;
    if ('role' in body) patch.role = body.role;
    if ('loginEnabled' in body) patch.loginEnabled = body.loginEnabled;
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    if ('email' in patch) {
      const em = String(patch.email).toLowerCase().trim();
      if (!em) return res.status(400).json({ error: 'Email is required' });
      const ex = await User.findUserByEmail(em);
      if (ex && String(ex.id) !== String(userId)) {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }
      patch.email = em;
    }
    const row = await User.updateStaffUserInOrg(userId, orgId, patch);
    if (!row) return res.status(404).json({ error: 'User not found' });
    res.json({ user: publicStaffUser(row) });
  });

  router.get('/organizations/:id/users/:userId/avatar', async (req, res) => {
    const orgId = req.params.id;
    const { userId } = req.params;
    const target = await assertClientUserInOrg(orgId, userId, req.user);
    if (!target) return res.status(404).end();
    const name = await User.getProfileAvatarFilename(userId);
    if (!name) return res.status(404).end();
    sendAvatarFileOr404(res, name);
  });

  router.post('/organizations/:id/users/:userId/avatar', handlePlatformUserCreateUpload, async (req, res) => {
    const orgId = req.params.id;
    const { userId } = req.params;
    const target = await assertClientUserInOrg(orgId, userId, req.user);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const prev = await User.getProfileAvatarFilename(userId);
    const ext = extensionForUpload(req.file);
    const base = `${userId}${ext || '.png'}`;
    try {
      if (prev && prev !== base) {
        try {
          await fs.promises.unlink(avatarFilePath(prev));
        } catch {
          /* ignore */
        }
      }
      await fs.promises.writeFile(avatarFilePath(base), req.file.buffer);
      await User.setProfileAvatarFilename(userId, base);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Could not save image' });
    }
    const outRow = await User.findUserById(userId);
    res.json({ user: publicStaffUser(outRow) });
  });

  router.delete('/organizations/:id/users/:userId/avatar', async (req, res) => {
    const orgId = req.params.id;
    const { userId } = req.params;
    const target = await assertClientUserInOrg(orgId, userId, req.user);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const prev = await User.clearProfileAvatarFilename(userId);
    if (prev) {
      try {
        await fs.promises.unlink(avatarFilePath(prev));
      } catch {
        /* ignore */
      }
    }
    const outRow = await User.findUserById(userId);
    res.json({ user: publicStaffUser(outRow) });
  });

  router.post('/organizations/:id/invites', requireBodyFields(['email']), async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    const invitedRole = req.body.invitedRole === 'admin' ? 'admin' : 'employee';
    const email = req.body.email;
    const firstName = req.body.firstName;
    const lastName = req.body.lastName;
    const existing = await User.findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
    const invite = await Invite.createInvite({
      email,
      token,
      organizationId: org.id,
      expiresAt,
      invitedRole,
      firstName,
      lastName,
    });
    res.status(201).json({
      invite: {
        id: invite.id,
        email: invite.email,
        expiresAt: invite.expires_at,
        invitedRole: invite.invited_role,
        firstName: invite.first_name ?? '',
        lastName: invite.last_name ?? '',
      },
      inviteUrl: `/invite/${token}`,
    });
  });

  router.get('/organizations/:id', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    res.json({ organization: org });
  });

  router.get('/organizations/:id/logo', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org || !org.company_logo_filename) return res.status(404).end();
    sendOrgLogoFileOr404(res, org.company_logo_filename);
  });

  router.post('/organizations/:id/user-import-template', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const body = req.body || {};
    if (!Array.isArray(body.groupLevelLabels)) {
      return res.status(400).json({ error: 'groupLevelLabels must be an array' });
    }
    const labels = body.groupLevelLabels
      .slice(0, 5)
      .map((label) => String(label ?? '').trim());
    if (labels.length === 0 || labels.some((label) => !label)) {
      return res.status(400).json({ error: 'groupLevelLabels must contain 1-5 non-empty labels' });
    }
    if (Object.prototype.hasOwnProperty.call(body, 'groupLevels')) {
      const parsed = Number.parseInt(String(body.groupLevels), 10);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
        return res.status(400).json({ error: 'groupLevels must be an integer from 1 to 5' });
      }
      if (parsed !== labels.length) {
        return res.status(400).json({ error: 'groupLevelLabels length must match groupLevels' });
      }
    }
    const csv = buildClientUserImportTemplateCsv(labels);
    const safeOrgId = String(req.params.id || '').replace(/[^a-zA-Z0-9-]/g, '');
    const filename = `client-${safeOrgId || 'org'}-user-import-template.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);
  });

  router.post('/organizations/:id/logo', handleOrgLogoPlatformUpload, async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const ext = extensionForUpload(req.file);
    const base = `org-${org.id}${ext || '.png'}`;
    try {
      if (org.company_logo_filename && org.company_logo_filename !== base) {
        try {
          await fs.promises.unlink(orgLogoFilePath(org.company_logo_filename));
        } catch {
          /* ignore */
        }
      }
      await fs.promises.writeFile(orgLogoFilePath(base), req.file.buffer);
      const updated = await Organization.setCompanyLogoFilename(org.id, base);
      res.json({ organization: updated });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Could not save logo' });
    }
  });

  router.delete('/organizations/:id/logo', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const prev = await Organization.clearCompanyLogoFilename(req.params.id);
    if (prev) {
      try {
        await fs.promises.unlink(orgLogoFilePath(prev));
      } catch {
        /* ignore */
      }
    }
    const updated = await Organization.getOrganization(req.params.id);
    res.json({ organization: updated });
  });

  router.get('/organizations/:id/pulse-sessions', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const sessions = await PulseSession.listSessionsForOrg(req.params.id);
    res.json({ sessions: sessions.map(publicPulseSessionRow) });
  });

  router.post('/organizations/:id/pulse-timepoints/during', async (req, res, next) => {
    try {
      const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
      if (!org) return res.status(404).json({ error: 'Organization not found' });
      if (!organizationHasService(org.settings, CLIENT_SERVICE_PULSE)) {
        return res.status(403).json({ error: 'Rhythm Engine is not enabled for this client' });
      }

      const name = createDuringPulseCheckpointName(new Date());
      const [staffSession, managerSession] = await Promise.all([
        createFreshActiveDuringSession(org.id, name, 'staff'),
        createFreshActiveDuringSession(org.id, name, 'manager'),
      ]);

      return res.status(201).json({
        checkpointDate: pulseSessionDateKey(staffSession),
        sessions: [staffSession, managerSession].map(publicPulseSessionRow),
      });
    } catch (error) {
      if (error?.code === '23505') {
        return res.status(409).json({
          error: 'An active pulse checkpoint was created concurrently. Please refresh and retry.',
        });
      }
      return next(error);
    }
  });

  router.get('/organizations/:id/pulse-dashboard', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const requestedTimepoint = parsePulseDashboardTimepoint(req.query?.timepoint);

    const requestedDuringSessionId = String(req.query?.duringSessionId || '').trim();
    const [sessions, activeUsersByRole, inviteRows] = await Promise.all([
      PulseSession.listSessionsForOrg(req.params.id),
      User.countActiveUsersByRoleForOrg(req.params.id),
      PulseLinkInvite.listInviteRowsForOrg(req.params.id, {
        timepointPhase: requestedTimepoint,
        duringSessionId: requestedDuringSessionId || null,
      }),
    ]);
    const pulseLinkByRole = inviteRows.reduce(
      (acc, row) => {
        if (row.survey_role === 'manager') acc.manager += 1;
        else acc.staff += 1;
        return acc;
      },
      { staff: 0, manager: 0 }
    );
    const managerOptions = inviteRows
      .filter((r) => r.survey_role === 'manager')
      .map((r) => ({
        id: r.id,
        displayName: r.display_name || '',
        email: r.email,
      }));
    const managerIdSet = new Set(managerOptions.map((m) => m.id));
    const requestedManagerIds = parseManagerIdsFromQuery(req.query);
    const selectedManagerIds = requestedManagerIds.filter((id) => managerIdSet.has(id));
    const selectedManagerIdSet = new Set(selectedManagerIds);
    const managerFilterActive = selectedManagerIds.length > 0;
    const includeManagerSelf = parseQueryBool(req.query?.includeManagerSelf, false);

    const requestedStage = requestedTimepoint ? normalizePulseStage(requestedTimepoint, null) : null;
    const requestedDuringDate = String(req.query?.duringDate || '').trim();
    const timepointFiltered = requestedTimepoint
      ? sessions.filter((s) => pulseSessionTimepointKind(s) === requestedTimepoint)
      : sessions;
    const dateFiltered = requestedTimepoint === 'during' && requestedDuringDate
      ? timepointFiltered.filter((s) => pulseSessionDateKey(s) === requestedDuringDate)
      : timepointFiltered;
    const sessionFiltered = requestedTimepoint === 'during' && requestedDuringSessionId
      ? timepointFiltered.filter((s) => String(s.id) === requestedDuringSessionId)
      : dateFiltered;
    const candidateSessions =
      sessionFiltered.length > 0
        ? sessionFiltered
        : (dateFiltered.length > 0 ? dateFiltered : timepointFiltered);

    const activeSessions = candidateSessions.filter((s) => s.status === 'active');
    const currentSession =
      candidateSessions.find((s) => s.status === 'active' && s.audience === 'staff') ||
      candidateSessions.find((s) => s.status === 'active' && s.audience === 'manager') ||
      candidateSessions[0] ||
      null;

    const sessionsForCurrentRows =
      requestedTimepoint === 'pre' || requestedTimepoint === 'completed'
        ? sessions
        : (activeSessions.length > 0 ? activeSessions : currentSession ? [currentSession] : []);
    const currentRows =
      sessionsForCurrentRows.length > 0
        ? (
            await Promise.all(
              sessionsForCurrentRows.map((s) => listMergedResponsesForSession(s.id, requestedStage))
            )
          ).flat()
        : [];
    const scopedCurrentRows = filterRowsForManagerScope(
      currentRows,
      selectedManagerIdSet,
      includeManagerSelf
    );
    const completedRows = scopedCurrentRows.filter((r) => r.completed_at);

    const currentScored = completedRows
      .map((r) => responseScoresOutOf40(r))
      .filter((s) => s.valid && s.adoption != null && s.sponsorship != null);

    const adoptionScore =
      currentScored.length > 0
        ? round1(currentScored.reduce((sum, s) => sum + s.adoption, 0) / currentScored.length)
        : null;
    const sponsorshipScore =
      currentScored.length > 0
        ? round1(currentScored.reduce((sum, s) => sum + s.sponsorship, 0) / currentScored.length)
        : null;

    const completedEmployeeRows = completedRows.filter((r) => r.role === 'employee');
    const completedManagerRows = completedRows.filter((r) => r.role === 'admin');
    const completedEmployeeResponses = completedEmployeeRows.length;
    const completedManagerResponses = completedManagerRows.length;

    let invitedEmployees = activeUsersByRole.employee || 0;
    let invitedManagers = activeUsersByRole.admin || 0;
    let pulseLinkStaff = pulseLinkByRole.staff;
    let pulseLinkManager = pulseLinkByRole.manager;
    if (managerFilterActive) {
      pulseLinkStaff = inviteRows.filter(
        (r) => r.survey_role === 'staff' && r.manager_invite_id && selectedManagerIdSet.has(r.manager_invite_id)
      ).length;
      pulseLinkManager = includeManagerSelf ? selectedManagerIds.length : 0;
      invitedEmployees = pulseLinkStaff;
      invitedManagers = pulseLinkManager;
    }
    const pulseLinkInvitedCount = pulseLinkStaff + pulseLinkManager;
    const invitedTotal = managerFilterActive
      ? pulseLinkInvitedCount
      : invitedEmployees + invitedManagers + pulseLinkInvitedCount;
    const completedTotal = completedRows.length;

    const quadrantBuckets = {
      'Motivated but Lost': 0,
      Optimal: 0,
      'High Risk': 0,
      'Capable but Wary': 0,
    };
    for (const s of currentScored) {
      const q = s.quadrantLabel || quadrantLabel(s.adoption, s.sponsorship);
      quadrantBuckets[q] += 1;
    }
    const quadrantNames = ['Motivated but Lost', 'Optimal', 'High Risk', 'Capable but Wary'];
    const quadrantCounts = quadrantNames.map((name) => quadrantBuckets[name]);
    const quadrantPercents = calculateLargestRemainderPercentages(quadrantCounts);
    const quadrants = quadrantNames.map((name, idx) => ({
      name,
      count: quadrantBuckets[name],
      percent: quadrantPercents[idx],
    }));

    const managerLoadCounts = {
      Sustainable: 0,
      Stretched: 0,
      'At Capacity': 0,
      Overloaded: 0,
    };
    for (const row of completedManagerRows) {
      const scored = responseScoresOutOf40(row);
      if (!scored.valid || !scored.managerLoadBand) continue;
      managerLoadCounts[scored.managerLoadBand] += 1;
    }
    const loadBandNames = ['Sustainable', 'Stretched', 'At Capacity', 'Overloaded'];
    const managerLoadBandCounts = loadBandNames.map((name) => managerLoadCounts[name]);
    const managerLoadPercents = calculateLargestRemainderPercentages(managerLoadBandCounts);
    const managerLoad = {
      total: completedManagerRows.length,
      bands: loadBandNames.map((name, idx) => ({
        name,
        count: managerLoadCounts[name],
        percent: managerLoadPercents[idx],
      })),
    };

    const completedScoredRows = completedRows
      .map((row) => ({
        role: row.role,
        scored: responseScoresOutOf40(row),
      }))
      .filter((entry) => entry.scored.valid);

    const dimensions = DIMENSIONS.map((dimension) => {
      const employeeValues = completedScoredRows
        .filter((entry) => entry.role !== 'admin')
        .map((entry) => entry.scored.dimensions.find((d) => d.id === dimension.id))
        .filter(Boolean)
        .map((d) => d.average);

      const managerValues = completedScoredRows
        .filter((entry) => entry.role === 'admin')
        .map((entry) => entry.scored.dimensions.find((d) => d.id === dimension.id))
        .filter(Boolean)
        .map((d) => d.average);

      const employeeHighCount = employeeValues.filter((value) => value >= 4).length;
      const managerHighCount = managerValues.filter((value) => value >= 4).length;

      return {
        id: dimension.id,
        label: dimension.employeeLabel,
        managerLabel: dimension.managerLabel,
        energyAvg:
          employeeValues.length > 0
            ? round1(employeeValues.reduce((sum, value) => sum + value, 0) / employeeValues.length)
            : null,
        frictionAvg:
          managerValues.length > 0
            ? round1(managerValues.reduce((sum, value) => sum + value, 0) / managerValues.length)
            : null,
        highEnergyPercent:
          employeeValues.length > 0 ? round1((employeeHighCount / employeeValues.length) * 100) : 0,
        managerHighPercent:
          managerValues.length > 0 ? round1((managerHighCount / managerValues.length) * 100) : 0,
      };
    });

    // Rolling 7-day buckets. Bucket 0 = most recent 7 days, bucket 3 = 21–28 days ago.
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const now = new Date();
    const weekBuckets = Array.from({ length: 4 }, (_, i) => ({
      weekLabel: `W${4 - i}`,
      start: new Date(now.getTime() - (i + 1) * WEEK_MS),
      end: new Date(now.getTime() - i * WEEK_MS),
    }));

    const sessionsForTrend =
      requestedTimepoint === 'pre' || requestedTimepoint === 'completed'
        ? sessions
        : (candidateSessions.length > 0 ? candidateSessions : sessions);
    const allSessionRows = sessionsForTrend.length > 0
      ? (
          await Promise.all(
            sessionsForTrend.map((s) => listMergedResponsesForSession(s.id, requestedStage))
          )
        ).flat()
      : [];
    const allScopedRows = filterRowsForManagerScope(allSessionRows, selectedManagerIdSet, includeManagerSelf);

    const trendScopedRowsByBucket = weekBuckets.map((bucket) => ({
      bucket,
      rows: allScopedRows.filter((r) => {
        if (!r.completed_at) return false;
        const ts = new Date(r.completed_at).getTime();
        return ts >= bucket.start.getTime() && ts < bucket.end.getTime();
      }),
    }));

    const trendRows = trendScopedRowsByBucket.map(({ bucket, rows }) => {
      const scored = rows
        .map((r) => responseScoresOutOf40(r))
        .filter((s) => s.valid && s.adoption != null && s.sponsorship != null);
      return {
        weekLabel: bucket.weekLabel,
        adoptionScore:
          scored.length > 0
            ? round1(scored.reduce((sum, s) => sum + s.adoption, 0) / scored.length)
            : null,
        sponsorshipScore:
          scored.length > 0
            ? round1(scored.reduce((sum, s) => sum + s.sponsorship, 0) / scored.length)
            : null,
        completedResponses: rows.length,
      };
    });

    const managersForBreakdown = managerFilterActive
      ? managerOptions.filter((m) => selectedManagerIdSet.has(m.id))
      : managerOptions;
    const byManager = managersForBreakdown.map((manager) => {
      const managerCompletedRows = completedRows.filter((row) => {
        if (row?.manager_invite_id === manager.id) return true;
        if (!includeManagerSelf) return false;
        return !row?.user_id && row?.role === 'admin' && row?.invite_id === manager.id;
      });
      const managerScored = managerCompletedRows
        .map((row) => responseScoresOutOf40(row))
        .filter((s) => s.valid && s.adoption != null && s.sponsorship != null);
      const managerAdoption =
        managerScored.length > 0
          ? round1(managerScored.reduce((sum, s) => sum + s.adoption, 0) / managerScored.length)
          : null;
      const managerSponsorship =
        managerScored.length > 0
          ? round1(managerScored.reduce((sum, s) => sum + s.sponsorship, 0) / managerScored.length)
          : null;
      const managerQuadrant =
        managerAdoption != null && managerSponsorship != null
          ? quadrantLabel(managerAdoption, managerSponsorship)
          : null;

      let loadBand = null;
      const managerSelfRow = completedRows.find(
        (row) => !row?.user_id && row?.role === 'admin' && row?.invite_id === manager.id
      );
      if (managerSelfRow) {
        const selfScore = responseScoresOutOf40(managerSelfRow);
        loadBand = selfScore.valid ? selfScore.managerLoadBand || null : null;
      }

      const trend = trendScopedRowsByBucket.map(({ bucket, rows: bucketRows }) => {
        const managerBucketRows = bucketRows.filter(
          (row) =>
            row?.manager_invite_id === manager.id ||
            (includeManagerSelf && !row?.user_id && row?.role === 'admin' && row?.invite_id === manager.id)
        );
        const bucketScored = managerBucketRows
          .map((row) => responseScoresOutOf40(row))
          .filter((s) => s.valid && s.adoption != null && s.sponsorship != null);
        const adoption =
          bucketScored.length > 0
            ? round1(bucketScored.reduce((sum, s) => sum + s.adoption, 0) / bucketScored.length)
            : null;
        const sponsorship =
          bucketScored.length > 0
            ? round1(bucketScored.reduce((sum, s) => sum + s.sponsorship, 0) / bucketScored.length)
            : null;
        return {
          weekLabel: bucket.weekLabel,
          adoptionScore: adoption,
          sponsorshipScore: sponsorship,
          completedResponses: managerBucketRows.length,
        };
      });

      return {
        managerId: manager.id,
        managerName: manager.displayName || manager.email,
        managerEmail: manager.email,
        directReportInvitedCount: inviteRows.filter(
          (r) => r.survey_role === 'staff' && r.manager_invite_id === manager.id
        ).length,
        directReportCompletedCount: completedRows.filter(
          (row) => row.role === 'employee' && row.manager_invite_id === manager.id
        ).length,
        completedResponses: managerCompletedRows.length,
        adoptionScore: managerAdoption,
        sponsorshipScore: managerSponsorship,
        quadrant: managerQuadrant,
        managerLoadBand: loadBand,
        trend,
      };
    });

    const sponsorshipConfig = sponsorshipConfigFromOrgSettings(org.settings);
    const managerInviteMap = new Map(managerOptions.map((row) => [row.id, row]));
    const managerSelfMetrics = completedManagerRows
      .map((row) => {
        const scored = responseScoresOutOf40(row);
        if (!scored.valid) return null;
        const managerId = row?.invite_id || null;
        if (!managerId) return null;
        const managerProfile = managerInviteMap.get(managerId) || null;
        const receivedScore = scored.sponsorshipReceivedScore;
        const capacityScore = scored.sponsorshipCapacityScore;
        const loadScore = scored.sponsorshipLoadScore;
        if (receivedScore == null || capacityScore == null || loadScore == null) return null;
        const loadBand = scoreBandForSponsorshipLoad(loadScore, sponsorshipConfig.loadBandBoundaries);
        const chainState = classifySponsorshipChainState(receivedScore, capacityScore, {
          receivedThreshold: sponsorshipConfig.receivedThreshold,
          capacityThreshold: sponsorshipConfig.capacityThreshold,
        });
        return {
          managerId,
          managerName: managerProfile?.displayName || managerProfile?.email || null,
          managerEmail: managerProfile?.email || null,
          receivedScore,
          capacityScore,
          loadScore,
          loadBand,
          chainState,
        };
      })
      .filter(Boolean);

    const managerRespondentCount = managerSelfMetrics.length;
    const receivedAvg =
      managerRespondentCount > 0
        ? round1(
            managerSelfMetrics.reduce((sum, row) => sum + row.receivedScore, 0) / managerRespondentCount
          )
        : null;
    const capacityAvg =
      managerRespondentCount > 0
        ? round1(
            managerSelfMetrics.reduce((sum, row) => sum + row.capacityScore, 0) / managerRespondentCount
          )
        : null;
    const receivedThresholdStatus =
      receivedAvg != null && receivedAvg >= sponsorshipConfig.receivedThreshold
        ? 'Above Threshold'
        : 'Below Threshold';
    const capacityThresholdStatus =
      capacityAvg != null && capacityAvg >= sponsorshipConfig.capacityThreshold
        ? 'Above Threshold'
        : 'Below Threshold';

    const loadBandNamesV3 = sponsorshipLoadBandOrder();
    const loadBandCountsV3 = Object.fromEntries(loadBandNamesV3.map((name) => [name, 0]));
    for (const row of managerSelfMetrics) {
      loadBandCountsV3[row.loadBand] += 1;
    }
    const loadBandPercentsV3 = calculateLargestRemainderPercentages(
      loadBandNamesV3.map((name) => loadBandCountsV3[name] || 0)
    );
    const loadBandsV3 = loadBandNamesV3.map((name, idx) => ({
      name,
      count: loadBandCountsV3[name] || 0,
      percent: loadBandPercentsV3[idx] || 0,
    }));

    const chainStateNames = sponsorshipChainStateOrder();
    const chainStateCounts = Object.fromEntries(chainStateNames.map((name) => [name, 0]));
    for (const row of managerSelfMetrics) {
      chainStateCounts[row.chainState] += 1;
    }
    const chainStatePercents = calculateLargestRemainderPercentages(
      chainStateNames.map((name) => chainStateCounts[name] || 0)
    );
    const chainStates = chainStateNames.map((name, idx) => ({
      name,
      count: chainStateCounts[name] || 0,
      percent: chainStatePercents[idx] || 0,
    }));
    const chainMajority = [...chainStates].sort((a, b) => b.percent - a.percent)[0] || null;

    const matrixSeverityClass = (loadBand, chainState) => {
      if (loadBand === 'Sustainable' && chainState === 'Chain Functioning') return 'cx0';
      if (
        (loadBand === 'Sustainable' && chainState !== 'Chain Functioning')
        || (loadBand === 'Stretched' && chainState === 'Chain Functioning')
      ) return 'cx1';
      if (
        loadBand === 'Stretched'
        && (chainState === 'Breaking at Manager Level' || chainState === 'Managers Resilient, Under-Supported')
      ) return 'cx2';
      if (
        (loadBand === 'Stretched' && chainState === 'Sponsorship Failed at Both Levels')
        || (loadBand === 'At Capacity'
          && (chainState === 'Breaking at Manager Level' || chainState === 'Managers Resilient, Under-Supported'))
      ) return 'cx3';
      if (
        (loadBand === 'At Capacity' && chainState === 'Sponsorship Failed at Both Levels')
        || (loadBand === 'Overloaded' && chainState === 'Managers Resilient, Under-Supported')
      ) return 'cx4';
      if (loadBand === 'Overloaded' && chainState === 'Sponsorship Failed at Both Levels') return 'cx5';
      return 'cx3';
    };

    const matrixRowOrder = loadBandNamesV3;
    const matrixColOrder = chainStateNames;
    const matrixCountMap = new Map();
    for (const row of managerSelfMetrics) {
      const key = `${row.loadBand}::${row.chainState}`;
      matrixCountMap.set(key, (matrixCountMap.get(key) || 0) + 1);
    }
    const crossMatrixRows = matrixRowOrder.map((loadBand) => ({
      loadBand,
      cells: matrixColOrder.map((chainState) => {
        const count = matrixCountMap.get(`${loadBand}::${chainState}`) || 0;
        return {
          chainState,
          count,
          className: matrixSeverityClass(loadBand, chainState),
        };
      }),
    }));
    const crossMatrixTotal = crossMatrixRows.reduce(
      (sum, row) => sum + row.cells.reduce((rowSum, cell) => rowSum + (cell.count || 0), 0),
      0
    );

    const managerMetricsByManagerId = managerSelfMetrics.reduce((acc, item) => {
      if (!acc[item.managerId]) acc[item.managerId] = [];
      acc[item.managerId].push(item);
      return acc;
    }, {});
    const teamRows = Object.entries(managerMetricsByManagerId).map(([managerId, items]) => {
      const manager = managerInviteMap.get(managerId) || {};
      const chainTally = {};
      const loadTally = {};
      for (const item of items) {
        chainTally[item.chainState] = (chainTally[item.chainState] || 0) + 1;
        loadTally[item.loadBand] = (loadTally[item.loadBand] || 0) + 1;
      }
      const chainState = Object.keys(chainTally).sort((a, b) => {
        if (chainTally[b] !== chainTally[a]) return chainTally[b] - chainTally[a];
        return chainSeverityRank(b) - chainSeverityRank(a);
      })[0] || 'Chain Functioning';
      const loadBand = Object.keys(loadTally).sort((a, b) => {
        if (loadTally[b] !== loadTally[a]) return loadTally[b] - loadTally[a];
        return loadSeverityRank(b) - loadSeverityRank(a);
      })[0] || 'Sustainable';
      const receivedAvg1to5 = round1(
        items.reduce((sum, item) => sum + item.receivedScore / 4, 0) / items.length
      );
      const capacityAvg1to5 = round1(
        items.reduce((sum, item) => sum + item.capacityScore / 4, 0) / items.length
      );
      const managerBreakdown = byManager.find((row) => row.managerId === managerId) || null;
      return {
        teamName: manager.displayName || manager.email || managerId,
        managerId,
        responses: managerBreakdown?.directReportCompletedCount || 0,
        chainState,
        loadBand,
        receivedAvg: receivedAvg1to5,
        capacityAvg: capacityAvg1to5,
      };
    });
    const sortedTeamRows = [...teamRows].sort((a, b) => {
      const chainDiff = chainSeverityRank(b.chainState) - chainSeverityRank(a.chainState);
      if (chainDiff !== 0) return chainDiff;
      const loadDiff = loadSeverityRank(b.loadBand) - loadSeverityRank(a.loadBand);
      if (loadDiff !== 0) return loadDiff;
      return b.responses - a.responses;
    });
    const teamRowsLimited = sortedTeamRows.slice(0, sponsorshipConfig.teamTableDisplayLimit);

    const failingBothPercent =
      chainStates.find((state) => state.name === 'Sponsorship Failed at Both Levels')?.percent || 0;
    const highRiskTeamCount = sortedTeamRows.filter(
      (row) => row.chainState === 'Sponsorship Failed at Both Levels'
    ).length;
    const subScoresBelowThresholdPct =
      managerRespondentCount > 0
        ? round1(
            ((managerSelfMetrics.filter(
              (row) =>
                row.receivedScore < sponsorshipConfig.receivedThreshold
                || row.capacityScore < sponsorshipConfig.capacityThreshold
            ).length
              || 0)
              / managerRespondentCount)
            * 100
          )
        : 0;
    const interventionRequired =
      receivedAvg == null
      || capacityAvg == null
      || receivedAvg < sponsorshipConfig.receivedThreshold
      || capacityAvg < sponsorshipConfig.capacityThreshold;

    const verdictHeadline = interventionRequired
      ? 'The sponsorship chain is not functioning.'
      : 'The sponsorship chain is functioning.';
    const verdictBody = interventionRequired
      ? 'Managers are absorbing pressure from both directions — and the window to act is now.'
      : 'Leaders are receiving support and have capacity to sponsor change through their teams.';

    const sponsorshipSignals = buildSponsorshipSectionSignals({
      subScores: {
        received: { avg: receivedAvg, threshold: sponsorshipConfig.receivedThreshold },
        capacity: { avg: capacityAvg, threshold: sponsorshipConfig.capacityThreshold },
      },
      load: { bands: loadBandsV3 },
      chain: { states: chainStates },
      crossMatrix: { rows: crossMatrixRows },
      teams: { rows: sortedTeamRows },
    });
    const sponsorshipAnalysis = {
      verdict: {
        headline: verdictHeadline,
        body: verdictBody,
        badge: interventionRequired ? 'Intervention Required' : 'Monitoring',
        interventionRequired,
        provenance: `Based on ${managerRespondentCount} manager responses · Derived from MQ9-MQ16 · Threshold: ${sponsorshipConfig.receivedThreshold}/20 per sub-score`,
        chips: [
          { label: 'Sub-scores below threshold', value: `${Math.round(subScoresBelowThresholdPct)}%` },
          { label: 'Chain failure', value: `${failingBothPercent}% of managers` },
          { label: 'High-risk teams', value: `${highRiskTeamCount} teams identified` },
        ],
      },
      config: {
        receivedThreshold: sponsorshipConfig.receivedThreshold,
        capacityThreshold: sponsorshipConfig.capacityThreshold,
        loadBandBoundaries: sponsorshipConfig.loadBandBoundaries,
        teamTableDisplayLimit: sponsorshipConfig.teamTableDisplayLimit,
        aiSignalsEnabled: sponsorshipConfig.aiSignalsEnabled,
      },
      cohort: {
        managerRespondentCount,
      },
      section1: {
        cardLabel: 'Section 1 — Sponsorship Sub-Score Overview · Manager cohort only',
        explainer:
          'Breaks the overall Sponsorship Credibility score into two distinct constructs: what managers are receiving from senior leadership above them, and whether managers have the conditions to sponsor their own teams below.',
        whatThisMeasures: {
          received:
            'Whether senior leaders are visibly modelling the change, staying present under pressure, communicating the rationale clearly, and speaking with one voice.',
          capacity:
            'Whether managers have the autonomy, organisational support, personal resilience, and change leadership skills to sponsor their own teams effectively.',
        },
        received: {
          avg: receivedAvg,
          denominator: 20,
          questionRangeLabel: 'MQ9 — MQ12',
          threshold: sponsorshipConfig.receivedThreshold,
          status: receivedThresholdStatus,
          trackPercent: receivedAvg == null ? 0 : round1((receivedAvg / 20) * 100),
        },
        capacity: {
          avg: capacityAvg,
          denominator: 20,
          questionRangeLabel: 'MQ13 — MQ16',
          threshold: sponsorshipConfig.capacityThreshold,
          status: capacityThresholdStatus,
          trackPercent: capacityAvg == null ? 0 : round1((capacityAvg / 20) * 100),
        },
      },
      section2: {
        cardLabel: `Section 2 — Manager Load Report · ${managerRespondentCount} manager respondents`,
        explainer:
          'Measures the current capacity of each manager to absorb and lead additional change — scored from four questions about their workload, bandwidth, and self-reported sustainable load.',
        bands: loadBandsV3.map((band) => ({
          ...band,
          critical: band.name === 'Overloaded' && band.percent >= 10,
        })),
      },
      section3: {
        cardLabel: 'Section 3 — Sponsorship Chain Matrix · % of managers per quadrant',
        explainer:
          'Classifies each manager respondent into one of four sponsorship chain states by crossing whether they are receiving adequate senior sponsorship with whether they have the capacity to sponsor their own team.',
        states: chainStates,
        majorityState: chainMajority?.name || null,
      },
      section4: {
        cardLabel: `Section 4 — Load Band × Chain State · Manager count (n=${managerRespondentCount})`,
        explainer:
          'Crosses manager capacity (load band) against sponsorship chain state to identify which specific managers are simultaneously overloaded and unsupported — the group where intervention is most urgent before any change program is launched.',
        rows: crossMatrixRows,
        columnOrder: matrixColOrder,
        totalManagers: managerRespondentCount,
        totalCellCount: crossMatrixTotal,
      },
      section5: {
        cardLabel: `Section 5 — Team-Level Sponsorship Chain Breakdown · Showing ${teamRowsLimited.length} of ${sortedTeamRows.length} teams`,
        explainer:
          'Maps the sponsorship chain state to each team — distinguishing teams with local failure from those experiencing the broader organisational pattern, and identifying which teams require targeted pre-launch engagement.',
        rows: teamRowsLimited,
        totalRows: sortedTeamRows.length,
      },
      signals: sponsorshipConfig.aiSignalsEnabled ? sponsorshipSignals : null,
    };

    const previousWaveAdoptionScore = trendRows.length >= 2 ? trendRows[1].adoptionScore : null;
    const previousWaveSponsorshipScore = trendRows.length >= 2 ? trendRows[1].sponsorshipScore : null;
    const adoptionDelta = scoreDelta(adoptionScore, previousWaveAdoptionScore);
    const sponsorshipDelta = scoreDelta(sponsorshipScore, previousWaveSponsorshipScore);
    const launchVerdict = verdictForScores(adoptionScore, sponsorshipScore, READINESS_THRESHOLD);
    const launchHeadline = headlineForVerdict(launchVerdict);

    const baseAlerts = [];
    const overloadedBand = managerLoad.bands.find((b) => b.name === 'Overloaded');
    if (overloadedBand && overloadedBand.percent > 10) {
      baseAlerts.push({
        level: 'critical',
        title: `${overloadedBand.percent}% of managers are overloaded`,
        body: 'Launching with overloaded managers increases burnout risk. Reduce manager load before rollout.',
      });
    }
    if (adoptionScore != null && adoptionScore >= READINESS_THRESHOLD && adoptionDelta != null && adoptionDelta > 0) {
      baseAlerts.push({
        level: 'info',
        title: 'Adoption readiness is above threshold',
        body: 'Org conditions indicate teams can absorb change, pending sponsorship strength.',
      });
    }
    const sponsorshipDecliningAlerts = buildSponsorshipDecliningAlert({
      currentSponsorship: sponsorshipScore,
      previousSponsorship: previousWaveSponsorshipScore,
    });
    const dimensionFloorAlerts = buildDimensionFloorAlerts({ dimensions });
    const teamOutlierAlerts = buildTeamOutlierAlerts({
      byManager,
      orgAdoptionScore: adoptionScore,
      orgSponsorshipScore: sponsorshipScore,
    });
    const thresholdCrossingAlerts = buildThresholdCrossingAlerts({
      currentAdoption: adoptionScore,
      previousAdoption: previousWaveAdoptionScore,
      currentSponsorship: sponsorshipScore,
      previousSponsorship: previousWaveSponsorshipScore,
      threshold: READINESS_THRESHOLD,
    });
    const allAlerts = [
      ...baseAlerts,
      ...sponsorshipDecliningAlerts,
      ...dimensionFloorAlerts,
      ...teamOutlierAlerts,
      ...thresholdCrossingAlerts,
    ];
    const prioritizedAlerts = prioritizeAndCapAlerts(allAlerts, 5);
    const optimalQuadrant = quadrants.find((entry) => entry.name === 'Optimal');
    const highRiskQuadrant = quadrants.find((entry) => entry.name === 'High Risk');
    let soWhat = null;
    let soWhatStatus = 'ready';
    try {
      soWhat = await generatePulseSoWhatSummary({
        orgName: org.name,
        completedTotal,
        adoptionScore,
        sponsorshipScore,
        threshold: READINESS_THRESHOLD,
        optimalPercent: optimalQuadrant?.percent || 0,
        highRiskPercent: highRiskQuadrant?.percent || 0,
        overloadedPercent: overloadedBand?.percent || 0,
        alertTitles: prioritizedAlerts.alerts.map((alert) => alert.title),
      });
    } catch (error) {
      soWhatStatus = 'unavailable';
    }

    schedulePulseAlertNotifications({
      clientOrgId: org.id,
      orgName: org.name,
      alerts: allAlerts.filter((a) => a.level === 'critical' || a.level === 'warning'),
    });

    const employeeRowsWithManagerTag = completedEmployeeRows.filter((row) => row.manager_invite_id).length;
    const managersWithComparableTeamSize = byManager.filter(
      (row) => (row.directReportCompletedCount || 0) >= 5
    ).length;
    const teamSuppressedManagerCount = Math.max(0, byManager.length - managersWithComparableTeamSize);

    res.json({
      currentSession: currentSession ? publicPulseSessionRow(currentSession) : null,
      sessions: sessions.map(publicPulseSessionRow),
      kpis: {
        invitedTotal,
        invitedEmployees,
        invitedManagers,
        pulseLinkInvitedCount,
        completedTotal,
        completedEmployees: completedEmployeeResponses,
        completedManagers: completedManagerResponses,
        participationRate: round1(ratio(completedTotal, invitedTotal) * 100),
        employeeParticipationRate: round1(
          ratio(completedEmployeeResponses, invitedEmployees + pulseLinkStaff) * 100
        ),
        managerParticipationRate: round1(
          ratio(completedManagerResponses, invitedManagers + pulseLinkManager) * 100
        ),
        pulseLinkInvitedStaff: pulseLinkStaff,
        pulseLinkInvitedManager: pulseLinkManager,
        adoptionScore,
        sponsorshipScore,
        adoptionDelta,
        sponsorshipDelta,
        launchVerdict,
        launchHeadline,
      },
      scoreSemantics: {
        threshold: READINESS_THRESHOLD,
        averaging: 'pooled_completed_respondents',
        period: '7_day_rolling_bucket',
        deltaReference: 'previous_7_day_bucket',
      },
      quadrants,
      managerLoad,
      dimensions,
      trend: trendRows,
      managers: managerOptions,
      managerFilter: {
        selectedManagerIds,
        includeManagerSelf,
      },
      coverage: {
        managerDataPresent: completedManagerResponses > 0,
        managerResponseCoveragePercent: round1(ratio(completedManagerResponses, completedTotal) * 100),
        employeeManagerAssignmentCoveragePercent: round1(
          ratio(employeeRowsWithManagerTag, completedEmployeeResponses) * 100
        ),
        employeeRowsMissingManagerAssignment: completedEmployeeResponses - employeeRowsWithManagerTag,
        managersWithComparableTeamSize,
        teamSuppressedManagerCount,
      },
      byManager,
      sponsorshipAnalysis,
      alerts: prioritizedAlerts.alerts,
      alertsOverflowCount: prioritizedAlerts.overflowCount,
      narrative: soWhat,
      soWhat,
      soWhatStatus,
    });
  });

  router.post('/organizations/:id/pulse-handoff-link', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    if (!organizationHasService(org.settings, CLIENT_SERVICE_PULSE)) {
      return res.status(403).json({ error: 'Rhythm Engine is not enabled for this client' });
    }

    const pulseBaseUrl = resolvePulseAppBaseUrl();
    if (!pulseBaseUrl) {
      return res.status(500).json({ error: 'Set PULSE_APP_URL or APP_URL to issue Rhythm Engine links' });
    }

    const handoff = await createPulseHandoffToken({
      userId: req.user.id,
      organizationId: org.id,
    });
    const url = `${pulseBaseUrl}/sso/exchange?handoff=${encodeURIComponent(handoff.token)}&orgId=${encodeURIComponent(org.id)}`;
    res.json({
      url,
      expiresAt: handoff.expiresAt,
    });
  });

  router.get('/organizations/:id/pulse-link-invites', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint);
    const duringSessionId = parsePulseInviteDuringSessionId(req.query?.duringSessionId);
    const duringSessionError = validatePulseInviteDuringSession(timepointPhase, duringSessionId);
    if (duringSessionError) return res.status(400).json({ error: duringSessionError });
    const rows = await PulseLinkInvite.listInvitesForOrg(req.params.id, { timepointPhase, duringSessionId });
    res.json({ invites: rows.map(PulseLinkInvite.publicInviteRow) });
  });

  router.get('/organizations/:id/pulse-link-invites/templates', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const platformOrg = await Organization.getOrganization(req.user.organizationId);
    res.json({
      templates: pulseInviteTemplatesPayload(org, platformOrg?.settings),
      placeholders: PULSE_INVITE_TEMPLATE_PLACEHOLDERS,
    });
  });

  router.put('/organizations/:id/pulse-link-invites/templates', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const audience = String(req.body?.audience || '')
      .trim()
      .toLowerCase();
    if (!PULSE_INVITE_TEMPLATE_AUDIENCES.has(audience)) {
      return res.status(400).json({ error: 'audience must be staff or manager' });
    }
    const subject = String(req.body?.subject || '').trim();
    if (!subject) return res.status(400).json({ error: 'subject is required' });
    if (subject.length > PULSE_INVITE_TEMPLATE_MAX_SUBJECT_LENGTH) {
      return res.status(400).json({
        error: `subject must be ${PULSE_INVITE_TEMPLATE_MAX_SUBJECT_LENGTH} characters or less`,
      });
    }

    const bodyHtml = String(req.body?.bodyHtml || '').trim();
    if (!bodyHtml) return res.status(400).json({ error: 'bodyHtml is required' });
    if (bodyHtml.length > PULSE_INVITE_TEMPLATE_MAX_BODY_LENGTH) {
      return res.status(400).json({
        error: `bodyHtml is too long (max ${PULSE_INVITE_TEMPLATE_MAX_BODY_LENGTH} chars)`,
      });
    }

    const existingTemplates =
      org.settings?.pulseInviteEmailTemplates && typeof org.settings.pulseInviteEmailTemplates === 'object'
        ? org.settings.pulseInviteEmailTemplates
        : {};
    const updated = await Organization.updateOrganizationSettings(org.id, {
      pulseInviteEmailTemplates: {
        ...existingTemplates,
        [audience]: {
          subject,
          bodyHtml,
          updatedAt: new Date().toISOString(),
          updatedByUserId: req.user.id,
        },
      },
    });
    if (!updated) return res.status(404).json({ error: 'Organization not found' });
    const platformOrg = await Organization.getOrganization(req.user.organizationId);
    res.json({
      templates: pulseInviteTemplatesPayload(updated, platformOrg?.settings),
      placeholders: PULSE_INVITE_TEMPLATE_PLACEHOLDERS,
    });
  });

  router.post('/organizations/:id/pulse-link-invites/templates/send-test', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const audience = String(req.body?.audience || '')
      .trim()
      .toLowerCase();
    if (!PULSE_INVITE_TEMPLATE_AUDIENCES.has(audience)) {
      return res.status(400).json({ error: 'audience must be staff or manager' });
    }
    const subject = String(req.body?.subject || '').trim();
    if (!subject) return res.status(400).json({ error: 'subject is required' });
    if (subject.length > PULSE_INVITE_TEMPLATE_MAX_SUBJECT_LENGTH) {
      return res.status(400).json({
        error: `subject must be ${PULSE_INVITE_TEMPLATE_MAX_SUBJECT_LENGTH} characters or less`,
      });
    }

    const bodyHtml = String(req.body?.bodyHtml || '').trim();
    if (!bodyHtml) return res.status(400).json({ error: 'bodyHtml is required' });
    if (bodyHtml.length > PULSE_INVITE_TEMPLATE_MAX_BODY_LENGTH) {
      return res.status(400).json({
        error: `bodyHtml is too long (max ${PULSE_INVITE_TEMPLATE_MAX_BODY_LENGTH} chars)`,
      });
    }

    if (!isResendConfigured()) {
      return res.status(503).json({
        error: 'Email is not configured',
        details: 'Add RESEND_API_KEY in the server environment (e.g. Render → Environment).',
      });
    }
    const authUser = await User.findUserById(req.user.id);
    const targetEmail = String(authUser?.email || '')
      .trim()
      .toLowerCase();
    if (!targetEmail) {
      return res.status(400).json({ error: 'Your account does not have an email address for test sends.' });
    }
    const displayName = [
      authUser?.first_name,
      authUser?.last_name,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' ');
    const pulseBaseUrl = resolvePulseAppBaseUrl();
    const testLink = pulseBaseUrl
      ? `${pulseBaseUrl}/rhythm-engine/pre/link/test-link`
      : 'https://app.employeepulse.app/rhythm-engine/pre/link/test-link';
    try {
      await sendPulseInviteEmail(targetEmail, displayName || 'Test recipient', testLink, org.name, {
        audience,
        subjectTemplate: subject,
        bodyTemplateHtml: bodyHtml,
        clientLogoFilename: org.company_logo_filename,
        clientLogoAlt: org.name,
      });
    } catch (e) {
      const details = String(e?.message || '').slice(0, 500);
      return res.status(500).json({
        error: 'Could not send test email',
        details:
          details ||
          'Check RESEND_API_KEY, RESEND_FROM_EMAIL (or EMAIL_FROM) domain verification, and Resend logs.',
      });
    }
    return res.json({ ok: true, to: targetEmail });
  });

  router.post('/organizations/:id/pulse-link-invites/import', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint);
    const duringSessionId = parsePulseInviteDuringSessionId(req.query?.duringSessionId);
    const duringSessionError = validatePulseInviteDuringSession(timepointPhase, duringSessionId);
    if (duringSessionError) return res.status(400).json({ error: duringSessionError });
    const recipients = req.body?.recipients;
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'recipients must be a non-empty array' });
    }
    if (recipients.length > 2000) {
      return res.status(400).json({ error: 'Too many rows at once (max 2000)' });
    }
    const allowUnassignedStaff = parseTruthyQueryBool(req.query?.allowUnassignedStaff);
    const expectedGroupLevelLabels = normalizedGroupLevelLabelsFromSettings(org.settings);
    const result = await upsertPulseInviteRecipients({
      organizationId: req.params.id,
      timepointPhase,
      duringSessionId,
      recipients,
      allowUnassignedStaff,
      expectedGroupLevelLabels,
    });
    res.json(result);
  });

  router.post('/organizations/:id/pulse-link-invites/test-data', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const managerCount = Number.parseInt(String(req.body?.managerCount ?? ''), 10);
    const staffCount = Number.parseInt(String(req.body?.staffCount ?? ''), 10);
    if (!Number.isInteger(managerCount) || managerCount < 0) {
      return res.status(400).json({ error: 'managerCount must be a non-negative integer' });
    }
    if (!Number.isInteger(staffCount) || staffCount < 0) {
      return res.status(400).json({ error: 'staffCount must be a non-negative integer' });
    }
    if (managerCount === 0 && staffCount === 0) {
      return res.status(400).json({ error: 'At least one manager or staff user is required' });
    }
    if (staffCount > 0 && managerCount === 0) {
      return res.status(400).json({ error: 'At least one manager is required when staffCount is greater than 0' });
    }
    if (managerCount + staffCount > 2000) {
      return res.status(400).json({ error: 'Too many test users requested (max 2000)' });
    }

    const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint);
    const duringSessionId = parsePulseInviteDuringSessionId(req.query?.duringSessionId);
    const duringSessionError = validatePulseInviteDuringSession(timepointPhase, duringSessionId);
    if (duringSessionError) return res.status(400).json({ error: duringSessionError });
    const groupLabels = normalizedGroupLevelLabelsFromSettings(org.settings);
    const groupCounts = Array.isArray(req.body?.groupCounts) ? req.body.groupCounts : [];
    const normalizedGroupCounts = groupLabels.map((_, index) => normalizeGroupCountInput(groupCounts[index]));
    const datasetToken = randomUUID().replace(/-/g, '').slice(0, 12);

    const recipients = buildTestRecipients({
      managerCount,
      staffCount,
      groupLabels,
      groupCounts: normalizedGroupCounts,
      datasetToken,
    });
    const upsertResult = await upsertPulseInviteRecipients({
      organizationId: req.params.id,
      timepointPhase,
      duringSessionId,
      recipients,
      allowUnassignedStaff: false,
      expectedGroupLevelLabels: groupLabels,
    });

    const stage = internalTimepointToPulseStage(timepointPhase);
    let completedResponses = 0;
    const completionErrors = [];
    for (let index = 0; index < upsertResult.upsertedRows.length; index += 1) {
      const inviteRow = upsertResult.upsertedRows[index]?.invite;
      if (!inviteRow) continue;
      try {
        const audience = inviteRow.survey_role === 'manager' ? 'manager' : 'staff';
        const session = await PulseSession.resolveSessionForPulseLink(req.params.id, audience, stage);
        await PulseLinkResponse.ensureResponseRow(inviteRow.id, session.id, stage);
        const step1 = buildTestSurveyStepAnswers(inviteRow.survey_role, index);
        const completed = await PulseLinkResponse.completeResponse({
          inviteId: inviteRow.id,
          sessionId: session.id,
          stage,
          step1,
          step2: {},
          step3: {},
          step4: {},
          contributionStyle: null,
        });
        if (completed) completedResponses += 1;
      } catch (error) {
        completionErrors.push({
          inviteId: inviteRow.id,
          error: String(error?.message || 'response_completion_failed').slice(0, 200),
        });
      }
    }

    return res.json({
      ok: true,
      importedUsers: upsertResult.upserted,
      importErrorCount: upsertResult.errorCount,
      importErrors: upsertResult.errors,
      completedResponses,
      completionErrorCount: completionErrors.length,
      completionErrors: completionErrors.slice(0, 20),
      timepoint: stage,
    });
  });

  router.post('/organizations/:id/pulse-link-invites/repair-manager-role', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint ?? req.body?.timepoint);
    const duringSessionId = parsePulseInviteDuringSessionId(req.query?.duringSessionId ?? req.body?.duringSessionId);
    const duringSessionError = validatePulseInviteDuringSession(timepointPhase, duringSessionId);
    if (duringSessionError) return res.status(400).json({ error: duringSessionError });
    const applyRepair = parseQueryBool(
      req.query?.apply,
      parseQueryBool(req.body?.apply, false)
    );

    const responseRows = await PulseLinkInvite.listStaffInviteResponseRowsForOrg(req.params.id, {
      timepointPhase,
      duringSessionId,
    });
    const candidates = collectStaffInvitesNeedingManagerRole(responseRows);

    if (!applyRepair) {
      return res.json({
        dryRun: true,
        timepoint: internalTimepointToPulseStage(timepointPhase),
        candidateCount: candidates.length,
        candidates,
      });
    }

    const updated = await PulseLinkInvite.promoteInvitesToManagerInOrg(
      candidates.map((candidate) => candidate.inviteId),
      req.params.id,
      { timepointPhase, duringSessionId }
    );
    return res.json({
      dryRun: false,
      timepoint: internalTimepointToPulseStage(timepointPhase),
      candidateCount: candidates.length,
      updatedCount: updated.length,
      updatedInviteIds: updated.map((row) => row.id),
    });
  });

  router.post('/organizations/:id/pulse-link-invites/:inviteId/send', async (req, res) => {
    const orgId = req.params.id;
    const org = await assertClientOrganizationPlatformForUser(orgId, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint);
    const duringSessionId = parsePulseInviteDuringSessionId(req.query?.duringSessionId);
    const duringSessionError = validatePulseInviteDuringSession(timepointPhase, duringSessionId);
    if (duringSessionError) return res.status(400).json({ error: duringSessionError });
    const invite = await PulseLinkInvite.getInviteInOrg(req.params.inviteId, orgId, {
      timepointPhase,
      duringSessionId,
    });
    if (!invite) return res.status(404).json({ error: 'Invite not found' });
    if (await PulseLinkInvite.inviteHasCompletedSurvey(invite.id)) {
      return res.status(409).json({
        error: 'Survey already completed',
        details: 'This recipient has finished the questionnaire. The link cannot be resent.',
      });
    }
    const baseUrl = resolvePulseAppBaseUrl();
    if (!baseUrl) {
      return res.status(500).json({ error: 'Set PULSE_APP_URL (or APP_URL/FRONTEND_ORIGIN fallback) to send invite emails' });
    }
    if (!isResendConfigured()) {
      return res.status(503).json({
        error: 'Email is not configured',
        details: 'Add RESEND_API_KEY in the server environment (e.g. Render → Environment).',
      });
    }
    const rotated = await PulseLinkInvite.rotateTokenAndMarkSent(invite.id, orgId);
    if (!rotated) return res.status(500).json({ error: 'Could not prepare invite link' });
    const inviteStage = internalTimepointToPulseStage(invite.timepoint_phase);
    const linkUrl = `${baseUrl}/rhythm-engine/${inviteStage}/link/${rotated.rawToken}`;
    const audience = invite.survey_role === 'manager' ? 'manager' : 'staff';
    const platformOrg = await Organization.getOrganization(req.user.organizationId);
    const template = pulseInviteTemplateFromSettings(org.settings, audience, org.name, platformOrg?.settings);
    try {
      await sendPulseInviteEmail(invite.email, invite.display_name, linkUrl, org.name, {
        audience,
        subjectTemplate: template.subject,
        bodyTemplateHtml: template.bodyHtml,
        clientLogoFilename: org.company_logo_filename,
        clientLogoAlt: org.name,
      });
    } catch (e) {
      console.error('Rhythm Engine link invite send failed:', e);
      const details = String(e?.message || '').slice(0, 500);
      return res.status(500).json({
        error: 'Could not send email',
        details:
          details ||
          'Check RESEND_API_KEY, RESEND_FROM_EMAIL (or EMAIL_FROM) domain verification, and Resend logs.',
      });
    }
    res.json({ ok: true, invite: PulseLinkInvite.publicInviteRow(rotated.row) });
  });

  router.delete('/organizations/:id/pulse-link-invites/:inviteId', async (req, res) => {
    const orgId = req.params.id;
    const org = await assertClientOrganizationPlatformForUser(orgId, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint);
    const duringSessionId = parsePulseInviteDuringSessionId(req.query?.duringSessionId);
    const duringSessionError = validatePulseInviteDuringSession(timepointPhase, duringSessionId);
    if (duringSessionError) return res.status(400).json({ error: duringSessionError });
    const invite = await PulseLinkInvite.getInviteInOrg(req.params.inviteId, orgId, {
      timepointPhase,
      duringSessionId,
    });
    if (!invite) return res.status(404).json({ error: 'Invite not found' });
    if (await PulseLinkInvite.inviteHasCompletedSurvey(invite.id)) {
      return res.status(409).json({
        error: 'Survey already completed',
        details: 'This recipient has finished the questionnaire. They cannot be removed from the list.',
      });
    }
    const ok = await PulseLinkInvite.deleteInviteInOrg(invite.id, orgId, {
      timepointPhase,
      duringSessionId,
    });
    if (!ok) return res.status(404).json({ error: 'Invite not found' });
    res.status(204).end();
  });
}
