import fs from 'fs';
import { randomBytes, randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { requireBodyFields } from '../../middleware/validation.js';
import { extensionForUpload } from '../../middleware/avatarUpload.js';
import { avatarFilePath, orgLogoFilePath } from '../../config/storage.js';
import * as Organization from '../../models/Organization.js';
import * as User from '../../models/User.js';
import * as Invite from '../../models/Invite.js';
import * as LicenseConfig from '../../models/LicenseConfig.js';
import * as PasswordResetToken from '../../models/PasswordResetToken.js';
import * as PulseSession from '../../models/PulseSession.js';
import * as PulseLinkInvite from '../../models/PulseLinkInvite.js';
import * as PulseLinkResponse from '../../models/PulseLinkResponse.js';
import * as PlatformUserClientAssignment from '../../models/PlatformUserClientAssignment.js';
import {
  consumeAssessmentForClient,
  refundAssessmentForLicensee,
} from '../../services/assessmentMeter.js';
import * as AssessmentConsumptionEvent from '../../models/AssessmentConsumptionEvent.js';
const { SOURCE_PLATFORM_DURING_CHECKPOINT } = AssessmentConsumptionEvent;
import { runLicenseExpirySweep } from '../../services/licenseExpirySweep.js';
import { prospectSnapshotToCsv } from '../../services/prospectSnapshot.js';
import {
  auditFromRequest,
  AUDIT_ACTIONS,
  listRecentAuditEvents,
  publicAuditEvent,
} from '../../services/auditLog.js';
import {
  brandUploadLimiter,
  dataExportLimiter,
  expirySweepManualLimiter,
  inviteSendLimiter,
  offboardLimiter,
} from '../../middleware/sensitiveRateLimit.js';
import { signToken } from '../../middleware/auth.js';
import {
  isResendConfigured,
  getPulseInviteDefaultTemplate,
  getLicenseeWelcomeEmailDefaultTemplate,
  sendPlatformWelcomeEmail,
  sendLicenseeWelcomeEmail,
  sendPulseInviteEmail,
} from '../../services/email.js';
import {
  classifyQuadrant,
  classifySponsorshipChainState,
  DIMENSIONS,
  READINESS_THRESHOLD,
  getSurveyCopyForAudience,
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
  buildLikelihoodWhatThisMeansSignal,
  buildQuadrantExplanationSignal,
  normalizeAssessmentStageLabel,
  SCORE_CARD_SIGNAL_PROMPTS,
  buildTopScoreCardSignals,
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
import { generatePulseTrendSignals } from '../../services/pulseTrendSignals.js';
import {
  buildPerceptionGapFallbackNarrative,
  buildPerceptionGapFlaggedItems,
  requestPerceptionGapAiNarrative,
  PERCEPTION_GAP_ANALYSIS_MIN_SAMPLES,
} from '../../services/pulsePerceptionGapAnalysis.js';
import {
  normalizeInviteImportRecipients,
  validateInviteImportRows,
} from '../../services/pulseInviteImportValidation.js';
import { parseHumanTestDocx } from '../../services/pulseTestDataDocImport.js';
import { collectStaffInvitesNeedingManagerRole } from '../../services/pulseLinkRoleRepair.js';
import {
  internalTimepointToPulseStage,
  normalizePulseStage,
  pulseStageToInternalTimepoint,
} from '../../services/pulseStage.js';
import { createPulseHandoffToken } from '../../security/pulseHandoffToken.js';
import {
  CLIENT_SERVICE_LICENSEE,
  CLIENT_SERVICE_PULSE,
  LICENSEE_DOWNSTREAM_SERVICE_CATALOG,
  LICENSEE_DOWNSTREAM_SERVICE_IDS,
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

function readPositiveIntEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function runWithDeadline(taskFactory, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ timedOut: true, value: null, error: null });
    }, Math.max(0, timeoutMs));

    Promise.resolve()
      .then(() => taskFactory())
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ timedOut: false, value, error: null });
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ timedOut: false, value: null, error });
      });
  });
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

const NON_COMPARABLE_DIMENSION_IDS = new Set(['1C', '2C']);
const INTRA_DIMENSION_DIVERGENCE_THRESHOLD = 1.5;
const PERCEPTION_GAP_THRESHOLD = 1.5;

function formatScore1(value) {
  if (value == null || Number.isNaN(value)) return '--';
  return Number(value).toFixed(1);
}

function formatPercentInt(value) {
  if (value == null || Number.isNaN(value)) return '0%';
  return `${Math.round(Number(value))}%`;
}

function buildExecutiveSummaryContent({
  adoptionScore,
  sponsorshipScore,
  sponsorshipDelta,
  threshold,
  optimalPercent,
  highRiskPercent,
  overloadedPercent,
  criticalLoadPercent,
  interventionRequired,
  completedTotal,
}) {
  const headline = interventionRequired
    ? 'This organisation has capacity to change, but not yet the conditions to sustain it.'
    : 'This organisation is trending toward sustained change conditions if current sponsorship discipline holds.';
  const subhead = `Only ${formatPercentInt(optimalPercent)} of respondents are currently in Optimal. The remaining ${formatPercentInt(100 - (optimalPercent || 0))} sit across readiness states that require different intervention approaches.`;

  const riskChips = [
    sponsorshipScore != null && sponsorshipScore < threshold ? 'Sponsorship gap' : null,
    overloadedPercent > 10 ? 'Manager overload' : null,
    sponsorshipDelta != null && sponsorshipDelta < 0 ? 'Declining sponsorship trend' : null,
    criticalLoadPercent >= 35 ? 'Capacity concentration risk' : null,
    optimalPercent < 30 ? 'Low optimal readiness share' : null,
  ].filter(Boolean);

  const kpiBridgeText = sponsorshipDelta != null && sponsorshipDelta < 0
    ? `Response volume is not the risk. Adoption is ${formatScore1(adoptionScore)}/40 while Sponsorship is ${formatScore1(sponsorshipScore)}/40 and declining ${sponsorshipDelta > 0 ? '+' : ''}${formatScore1(sponsorshipDelta)} versus the prior wave — the two signals are now pulling in opposite directions.`
    : `Participation is strong, but launch risk depends on whether sponsorship and manager capacity keep pace with adoption movement through the next wave.`;

  const scenarios = [
    {
      id: 'do-nothing',
      tag: 'Scenario A · No Intervention',
      title: 'What happens if you do nothing',
      textA:
        adoptionScore == null || sponsorshipScore == null
          ? 'The current pattern remains unresolved: readiness risks persist and rollout friction accumulates in the middle of the organisation.'
          : `The change launches with Adoption at ${formatScore1(adoptionScore)}/40 and Sponsorship at ${formatScore1(sponsorshipScore)}/40. With ${formatPercentInt(highRiskPercent)} in High Risk and ${formatPercentInt(overloadedPercent)} overloaded manager capacity, early compliance is unlikely to convert into sustained behaviour change.`,
      textB:
        'Momentum stalls in teams already under strain, and the absence of targeted reinforcement makes course-correction slower and more expensive.',
      outcome:
        'Partial, unsustained adoption with high risk of reversion over the next 6-12 months.',
    },
    {
      id: 'traditional-change',
      tag: 'Scenario B · Traditional Change',
      title: 'What happens if you roll out traditional change',
      textA:
        sponsorshipScore != null && sponsorshipScore >= threshold
          ? 'Traditional change mechanics (comms, training, stakeholder plans) can improve consistency, but they do not automatically strengthen day-to-day sponsorship behaviour.'
          : 'Traditional change mechanics (comms, training, stakeholder plans) improve process discipline, but do not directly resolve low sponsorship credibility or manager load pressure.',
      textB:
        'Adoption improves where managers already have capacity; in constrained teams, extra process can add overhead without shifting the underlying conditions that determine whether change sticks.',
      outcome:
        'Uneven adoption, strong in pockets but fragile across the broader system.',
    },
    {
      id: 'experiential-campaign',
      tag: 'Scenario C · Experiential Campaign',
      title: 'What happens if you run an experiential campaign',
      textA:
        'An experiential campaign targets the conditions revealed by the diagnostic: visible sponsorship behaviour, manager enablement, and practical support for teams outside optimal readiness.',
      textB:
        optimalPercent >= 40
          ? 'Because a meaningful base is already in Optimal, targeted reinforcement can convert existing momentum into durable adoption across more teams.'
          : 'Because most respondents are outside Optimal, targeted interventions by readiness state can lift adoption while reducing sponsorship and load friction.',
      outcome:
        'Sustained, measurable adoption with stronger odds of retention after rollout.',
    },
  ];

  return {
    headline,
    subhead,
    riskChips,
    kpiBridgeText,
    scenarios,
    basedOnResponsesText: `Based on ${completedTotal || 0} responses · Threshold ${threshold}/40`,
  };
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
  const teamTableDisplayLimit = Number(source.teamTableDisplayLimit ?? 50);
  const aiSignalsEnabled = source.aiSignalsEnabled !== false;
  return {
    receivedThreshold,
    capacityThreshold,
    loadBandBoundaries,
    teamTableDisplayLimit:
      Number.isInteger(teamTableDisplayLimit) && teamTableDisplayLimit > 0
        ? teamTableDisplayLimit
        : 50,
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

function teamNameFromGroupValues(groupValues, fallbackName) {
  const normalized = Array.isArray(groupValues)
    ? groupValues.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (normalized.length > 0) return normalized[normalized.length - 1];
  return fallbackName;
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
  return normalizePulseStage(value);
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

function buildTestGroupValues(groupLabels, groupNames, index) {
  return groupLabels.map((_, groupIndex) => {
    const names = Array.isArray(groupNames?.[groupIndex])
      ? groupNames[groupIndex].filter((n) => String(n ?? '').trim())
      : [];
    if (names.length === 0) return null;
    return names[index % names.length];
  });
}

function buildTestRecipients({ managerCount, staffCount, groupLabels, groupNames, datasetToken }) {
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
      groupValues: buildTestGroupValues(groupLabels, groupNames, absoluteIndex),
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
      groupValues: buildTestGroupValues(groupLabels, groupNames, absoluteIndex),
    });
    absoluteIndex += 1;
  }

  return recipients;
}

function normalizeDisplayName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildDocImportInviteLookup(invites) {
  const buckets = new Map();
  const consumedInviteIds = new Set();
  const pushKey = (role, normalizedName, invite) => {
    if (!normalizedName) return;
    const key = `${role}:${normalizedName}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(invite);
  };
  for (const invite of invites) {
    const role = invite?.survey_role === 'manager' ? 'manager' : 'staff';
    const normalizedName = normalizeDisplayName(invite?.display_name || '');
    pushKey(role, normalizedName, invite);
    const emailLocalPart = String(invite?.email || '').split('@')[0];
    const normalizedEmailAlias = normalizeDisplayName(emailLocalPart);
    if (normalizedEmailAlias && normalizedEmailAlias !== normalizedName) {
      pushKey(role, normalizedEmailAlias, invite);
    }
  }
  return { buckets, consumedInviteIds };
}

function consumeInviteMatch(lookup, role, name) {
  if (!lookup || typeof lookup !== 'object') return null;
  const buckets = lookup.buckets instanceof Map ? lookup.buckets : null;
  const consumedInviteIds = lookup.consumedInviteIds instanceof Set ? lookup.consumedInviteIds : null;
  if (!buckets || !consumedInviteIds) return null;

  const consumeByKey = (normalizedKey) => {
    if (!normalizedKey) return null;
    const key = `${role}:${normalizedKey}`;
    const bucket = buckets.get(key);
    if (!Array.isArray(bucket) || bucket.length === 0) return null;
    while (bucket.length > 0) {
      const match = bucket.shift();
      if (!match?.id || consumedInviteIds.has(match.id)) continue;
      consumedInviteIds.add(match.id);
      if (bucket.length === 0) buckets.delete(key);
      return match;
    }
    buckets.delete(key);
    return null;
  };

  const normalizedName = normalizeDisplayName(name);
  if (!normalizedName) return null;

  const exact = consumeByKey(normalizedName);
  if (exact) return exact;

  const tokens = normalizedName.split(' ').filter(Boolean);
  for (let tokenCount = tokens.length - 1; tokenCount >= 1; tokenCount -= 1) {
    const truncated = tokens.slice(0, tokenCount).join(' ');
    const fallback = consumeByKey(truncated);
    if (fallback) return fallback;
  }

  return null;
}

function normalizeManagerReference(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
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
  const existingManagerRefs = existingInvites
    .filter((row) => row.survey_role === 'manager')
    .map((row) => row.email);
  const normalizedRows = normalizeInviteImportRecipients(recipients);
  const prevalidation = validateInviteImportRows(normalizedRows, invitesById, {
    allowStaffWithoutManagerRef: allowUnassignedStaff,
    expectedGroupLevels: expectedGroupLevelLabels.length,
    existingManagerRefs,
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
  for (const row of existingInvites) {
    if (row.survey_role !== 'manager') continue;
    const normalizedRef = normalizeManagerReference(row.email);
    if (!normalizedRef) continue;
    managerRefToInviteId.set(normalizedRef, row.id);
  }
  for (const item of upsertedRows) {
    if (item.source.surveyRole === 'manager') {
      const normalizedRef = normalizeManagerReference(item.source.email);
      if (normalizedRef) managerRefToInviteId.set(normalizedRef, item.invite.id);
    }
  }

  for (const item of upsertedRows) {
    const { source, invite } = item;
    if (source.surveyRole !== 'staff' && source.surveyRole !== 'manager') {
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
      const normalizedRef = normalizeManagerReference(source.managerRef);
      resolvedManagerId = normalizedRef ? (managerRefToInviteId.get(normalizedRef) || null) : null;
    }
    if (!resolvedManagerId) {
      if (source.surveyRole === 'staff' && allowUnassignedStaff) {
        await PulseLinkInvite.updateManagerInviteId(invite.id, organizationId, null, {
          timepointPhase,
          duringSessionId,
        });
        continue;
      }
      if (source.surveyRole === 'manager' && !source.managerRef) {
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
      if (source.surveyRole === 'manager') {
        await PulseLinkInvite.updateManagerInviteId(invite.id, organizationId, null, {
          timepointPhase,
          duringSessionId,
        });
        continue;
      }
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

const DEFAULT_PULSE_SESSION_PURPOSES = ['pre_project', 'during_project', 'completed_project'];
const DEFAULT_PULSE_SESSION_AUDIENCES = ['staff', 'manager'];

async function ensureDefaultPulseSessionsForOrg(organizationId) {
  const existing = await PulseSession.listSessionsForOrg(organizationId);
  const existingPurposes = new Set(
    existing.map((s) => `${s.session_purpose}:${s.audience || 'staff'}`)
  );
  const created = [];
  for (const purpose of DEFAULT_PULSE_SESSION_PURPOSES) {
    for (const audience of DEFAULT_PULSE_SESSION_AUDIENCES) {
      if (existingPurposes.has(`${purpose}:${audience}`)) continue;
      const name =
        purpose === 'pre_project'
          ? 'Pre'
          : purpose === 'during_project'
            ? 'During'
            : 'Post';
      const initialStatus = purpose === 'pre_project' ? 'active' : 'draft';
      try {
        const session = await PulseSession.createSession(
          organizationId,
          name,
          initialStatus,
          audience,
          purpose
        );
        created.push(session);
      } catch (error) {
        // Concurrent lazy init or an existing active session can trigger
        // unique violations; treat this initializer as best-effort/idempotent.
        if (error?.code !== '23505') throw error;
      }
    }
  }
  return created;
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

async function resolvePulseImportSessionForScope({
  organizationId,
  role,
  stage,
  duringSessionId,
  sessionCache,
}) {
  const audience = role === 'manager' ? 'manager' : 'staff';
  const cacheKey = `${audience}:${stage}:${String(duringSessionId || '')}`;
  if (sessionCache?.has(cacheKey)) return sessionCache.get(cacheKey);

  let resolved = null;
  if (stage === 'mid' && duringSessionId) {
    const selected = await PulseSession.getSessionById(duringSessionId, organizationId);
    if (selected && String(selected.session_purpose || '').trim().toLowerCase() === 'during_project') {
      if (selected.audience === audience) {
        resolved = selected;
      } else {
        const sessions = await PulseSession.listSessionsForOrg(organizationId);
        const targetRows = sessions.filter(
          (session) =>
            String(session?.session_purpose || '').trim().toLowerCase() === 'during_project'
            && String(session?.audience || 'staff').trim().toLowerCase() === audience
        );
        if (targetRows.length > 0) {
          const selectedAt = new Date(selected.created_at || 0).getTime();
          const sorted = targetRows
            .map((session) => {
              const createdAt = new Date(session?.created_at || 0).getTime();
              const distance = Number.isFinite(createdAt) && Number.isFinite(selectedAt)
                ? Math.abs(createdAt - selectedAt)
                : Number.MAX_SAFE_INTEGER;
              return { session, distance };
            })
            .sort((a, b) => a.distance - b.distance);
          resolved = sorted[0]?.session || null;
        }
      }
    }
  }

  if (!resolved) {
    resolved = await PulseSession.resolveSessionForPulseLink(organizationId, audience, stage);
  }
  if (sessionCache) sessionCache.set(cacheKey, resolved);
  return resolved;
}

function pairedDuringSessionsForSelection(sessions, selectedSessionId) {
  const selectedId = String(selectedSessionId || '').trim();
  if (!selectedId) return [];
  const duringSessions = (Array.isArray(sessions) ? sessions : []).filter(
    (session) => String(session?.session_purpose || '').trim().toLowerCase() === 'during_project'
  );
  const selected = duringSessions.find((session) => String(session?.id) === selectedId);
  if (!selected) return [];

  const selectedAudience = String(selected?.audience || 'staff').trim().toLowerCase() === 'manager' ? 'manager' : 'staff';
  const targetAudience = selectedAudience === 'manager' ? 'staff' : 'manager';
  const selectedCreatedAt = new Date(selected?.created_at || 0).getTime();

  const pickClosest = (rows) => rows
    .map((session) => {
      const createdAt = new Date(session?.created_at || 0).getTime();
      const distance = Number.isFinite(createdAt) && Number.isFinite(selectedCreatedAt)
        ? Math.abs(createdAt - selectedCreatedAt)
        : Number.MAX_SAFE_INTEGER;
      return { session, distance };
    })
    .sort((a, b) => a.distance - b.distance)[0]?.session || null;

  const sameNameRows = duringSessions.filter(
    (session) =>
      String(session?.audience || '').trim().toLowerCase() === targetAudience
      && String(session?.name || '').trim() === String(selected?.name || '').trim()
  );
  const targetRows = sameNameRows.length > 0
    ? sameNameRows
    : duringSessions.filter((session) => String(session?.audience || '').trim().toLowerCase() === targetAudience);
  const pair = targetRows.length > 0 ? pickClosest(targetRows) : null;

  return pair ? [selected, pair] : [selected];
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
const RELATIONSHIP_STATUSES = new Set(['warm', 'cold', 'lost', 'new', 'active-campaign']);
const CLIENT_STATUS_LEGACY_MAP = new Map([
  ['lead', 'prospect-new'],
  ['active', 'client-current'],
  ['inactive', 'client-previous'],
  ['closed', 'do-not-call-contact-blocked'],
]);
const PULSE_INVITE_TEMPLATE_AUDIENCES = new Set(['staff', 'manager']);
const PULSE_INVITE_TEMPLATE_TIMEPOINTS = new Set(['pre', 'mid', 'post']);
const PULSE_INVITE_TEMPLATE_MAX_SUBJECT_LENGTH = 200;
const PULSE_INVITE_TEMPLATE_MAX_BODY_LENGTH = 20000;
const PULSE_INVITE_TEMPLATE_PLACEHOLDERS = ['{{name}}', '{{link}}', '{{dueDate}}', '{{clientname}}'];
const PULSE_SURVEY_START_TEMPLATE_MAX_TEXT_LENGTH = 4000;
const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDateOnly(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!ISO_DATE_ONLY_RE.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return raw;
}

function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function surveyStartBodyHtmlFromRequest(body = {}) {
  const rawBodyHtml = String(body?.bodyHtml || '').trim();
  if (rawBodyHtml) return rawBodyHtml;
  const intro = String(body?.intro || '').trim();
  const context = String(body?.context || '').trim();
  if (!intro) return '';
  return `<p>${intro}</p>${context ? `<p>${context}</p>` : ''}`;
}

function normalizePulseInviteTemplateTimepointKey(timepointPhase) {
  const raw = String(timepointPhase || '')
    .trim()
    .toLowerCase();
  if (raw === 'mid' || raw === 'during') return 'mid';
  if (raw === 'post' || raw === 'completed') return 'post';
  return 'pre';
}

function pulseInviteScopeKey(timepointPhase, duringSessionId) {
  const normalized = normalizePulseInviteTemplateTimepointKey(timepointPhase);
  if (normalized === 'pre') return 'pre';
  if (normalized === 'post') return 'post';
  if (normalized !== 'mid') return null;
  const sessionId = String(duringSessionId || '').trim();
  if (!sessionId) return null;
  return `session:${sessionId}`;
}

function pulseInviteDueDatesFromSettings(settings) {
  const raw = settings?.pulseInviteDueDates;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalized = normalizeDateOnly(value);
    if (normalized) out[key] = normalized;
  }
  return out;
}

function pulseInviteDueDateForScope(settings, timepointPhase, duringSessionId) {
  const scopeKey = pulseInviteScopeKey(timepointPhase, duringSessionId);
  if (!scopeKey) return null;
  const dueDates = pulseInviteDueDatesFromSettings(settings);
  return dueDates[scopeKey] || null;
}

function pulseInviteTemplateBucketByTimepoint(settingsValue, timepointPhase) {
  const normalizedTimepoint = normalizePulseInviteTemplateTimepointKey(timepointPhase);
  const templates = settingsValue && typeof settingsValue === 'object' && !Array.isArray(settingsValue)
    ? settingsValue
    : {};
  const scopedKeys = [...Array.from(PULSE_INVITE_TEMPLATE_TIMEPOINTS), 'during', 'completed'];
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

function pulseSurveyStartFallbackTemplate(audience, timepointPhase = 'pre') {
  const role = audience === 'manager' ? 'manager' : 'staff';
  const stage = internalTimepointToPulseStage(normalizePulseInviteTemplateTimepointKey(timepointPhase));
  const defaultCopy = getSurveyCopyForAudience(role, stage);
  const intro = String(defaultCopy?.intro || '').trim();
  const context = role === 'manager'
    ? 'Your perspective as a manager helps leaders see what’s working and what might need attention.'
    : 'Your answers help leaders understand what’s working and what might need attention.';
  const bodyHtml = `<p>${intro || 'You’ve been invited to share a short, honest view of how work feels day to day. Most people finish in about five to ten minutes.'}</p><p>${context}</p>`;
  return {
    bodyHtml,
  };
}

function pulseSurveyStartDefaultTemplateFromSettings(settings, audience, timepointPhase = 'pre') {
  const role = audience === 'manager' ? 'manager' : 'staff';
  const fallback = pulseSurveyStartFallbackTemplate(role, timepointPhase);
  const defaults = pulseInviteTemplateBucketByTimepoint(
    settings?.pulseInviteDefaultSurveyStartTemplates,
    timepointPhase
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

function pulseSurveyStartTemplateFromSettings(settings, audience, platformSettings = null, timepointPhase = 'pre') {
  const role = audience === 'manager' ? 'manager' : 'staff';
  const fallback = pulseSurveyStartDefaultTemplateFromSettings(platformSettings, role, timepointPhase);
  const templates = pulseInviteTemplateBucketByTimepoint(settings?.pulseInviteSurveyStartTemplates, timepointPhase);
  const raw = templates && typeof templates === 'object' ? templates[role] : null;
  if (!raw || typeof raw !== 'object') return fallback;
  const bodyHtml = typeof raw.bodyHtml === 'string' ? raw.bodyHtml.trim() : '';
  const intro = typeof raw.intro === 'string' ? raw.intro.trim() : '';
  const context = typeof raw.context === 'string' ? raw.context.trim() : '';
  return {
    bodyHtml: bodyHtml || (intro ? `<p>${intro}</p>${context ? `<p>${context}</p>` : ''}` : fallback.bodyHtml),
  };
}

function pulseSurveyStartTemplatesPayload(org, platformSettings = null, timepointPhase = 'pre') {
  return {
    staff: pulseSurveyStartTemplateFromSettings(
      org?.settings,
      'staff',
      platformSettings,
      timepointPhase
    ),
    manager: pulseSurveyStartTemplateFromSettings(
      org?.settings,
      'manager',
      platformSettings,
      timepointPhase
    ),
  };
}

function pulseSurveyStartDefaultTemplatesPayload(platformOrg, timepointPhase = 'pre') {
  return {
    staff: pulseSurveyStartDefaultTemplateFromSettings(platformOrg?.settings, 'staff', timepointPhase),
    manager: pulseSurveyStartDefaultTemplateFromSettings(platformOrg?.settings, 'manager', timepointPhase),
  };
}

function pulseInviteDefaultTemplateFromSettings(settings, audience, organizationName, timepointPhase = 'pre') {
  const role = audience === 'manager' ? 'manager' : 'staff';
  const fallback = getPulseInviteDefaultTemplate(role, organizationName);
  const defaults = pulseInviteTemplateBucketByTimepoint(settings?.pulseInviteDefaultEmailTemplates, timepointPhase);
  const raw = defaults && typeof defaults === 'object' ? defaults[role] : null;
  if (!raw || typeof raw !== 'object') return fallback;
  const subject = typeof raw.subject === 'string' ? raw.subject.trim() : '';
  const bodyHtml = typeof raw.bodyHtml === 'string' ? raw.bodyHtml.trim() : '';
  return {
    subject: subject || fallback.subject,
    bodyHtml: bodyHtml || fallback.bodyHtml,
  };
}

function pulseInviteTemplateFromSettings(
  settings,
  audience,
  organizationName,
  platformSettings = null,
  timepointPhase = 'pre'
) {
  const role = audience === 'manager' ? 'manager' : 'staff';
  const fallback = pulseInviteDefaultTemplateFromSettings(platformSettings, role, organizationName, timepointPhase);
  const templates = pulseInviteTemplateBucketByTimepoint(settings?.pulseInviteEmailTemplates, timepointPhase);
  const raw = templates && typeof templates === 'object' ? templates[role] : null;
  if (!raw || typeof raw !== 'object') return fallback;
  const subject = typeof raw.subject === 'string' ? raw.subject.trim() : '';
  const bodyHtml = typeof raw.bodyHtml === 'string' ? raw.bodyHtml.trim() : '';
  return {
    subject: subject || fallback.subject,
    bodyHtml: bodyHtml || fallback.bodyHtml,
  };
}

function pulseInviteTemplatesPayload(org, platformSettings = null, timepointPhase = 'pre') {
  return {
    staff: pulseInviteTemplateFromSettings(org?.settings, 'staff', org?.name, platformSettings, timepointPhase),
    manager: pulseInviteTemplateFromSettings(org?.settings, 'manager', org?.name, platformSettings, timepointPhase),
  };
}

function pulseInviteDefaultTemplatesPayload(platformOrg, timepointPhase = 'pre') {
  return {
    staff: pulseInviteDefaultTemplateFromSettings(platformOrg?.settings, 'staff', platformOrg?.name, timepointPhase),
    manager: pulseInviteDefaultTemplateFromSettings(platformOrg?.settings, 'manager', platformOrg?.name, timepointPhase),
  };
}

const LICENSEE_WELCOME_TEMPLATE_MAX_SUBJECT_LENGTH = 200;
const LICENSEE_WELCOME_TEMPLATE_MAX_BODY_LENGTH = 20000;
const LICENSEE_WELCOME_TEMPLATE_PLACEHOLDERS = [
  'name',
  'licenseeName',
  'loginLink',
  'setPasswordLink',
  'tokenDays',
];

/**
 * Merge the saved per-platform licensee welcome template (if any) with the
 * default. Always returns both fields so the editor can render them.
 */
function licenseeWelcomeEmailTemplateFromSettings(settings) {
  const fallback = getLicenseeWelcomeEmailDefaultTemplate();
  const saved =
    settings?.licenseeWelcomeEmailTemplate
    && typeof settings.licenseeWelcomeEmailTemplate === 'object'
    && !Array.isArray(settings.licenseeWelcomeEmailTemplate)
      ? settings.licenseeWelcomeEmailTemplate
      : {};
  const subject = String(saved.subject || '').trim();
  const bodyHtml = String(saved.bodyHtml || '').trim();
  return {
    subject: subject || fallback.subject,
    bodyHtml: bodyHtml || fallback.bodyHtml,
    isCustomized: Boolean(subject || bodyHtml),
    updatedAt: saved.updatedAt || null,
    updatedByUserId: saved.updatedByUserId || null,
  };
}

function parseMultipartBool(v) {
  if (v === true || v === 'true' || v === '1') return true;
  if (v === false || v === 'false' || v === '0') return false;
  return false;
}

// Parse a multipart `clientServiceIds` field which can arrive as repeated
// form values (string[]), a single string, or a JSON-encoded array.
function parseMultipartServiceIds(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.map((id) => String(id || '').trim()).filter(Boolean);
  const value = String(raw).trim();
  if (!value) return [];
  if (value.startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((id) => String(id || '').trim()).filter(Boolean);
      }
    } catch {
      // fall through to comma fallback
    }
  }
  return value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
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

function normalizeRelationshipStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!RELATIONSHIP_STATUSES.has(raw)) return null;
  return raw;
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
    'Manager Email',
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
  const testDataDocUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });

  const requirePlatformAdminRole = (req, res, next) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    next();
  };

  router.get('/organizations', async (req, res) => {
    const requesterOrg = req.workspaceOrganization;
    if (requesterOrg?.kind === 'licensee') {
      const rows = await Organization.listClientOrganizationsForParent(
        requesterOrg.id,
        parsePagination(req.query)
      );
      return res.json({ organizations: rows });
    }
    if (req.user?.role === 'admin') {
      const rows = await Organization.listClientAndLicenseeOrganizations(parsePagination(req.query));
      return res.json({ organizations: rows });
    }
    const assignedOrgIds = await PlatformUserClientAssignment.listAssignedClientOrgIdsForUser(req.user.id);
    if (!assignedOrgIds.length) return res.json({ organizations: [] });
    const rows = await Organization.listClientOrganizationsByIds(assignedOrgIds, parsePagination(req.query));
    res.json({ organizations: rows });
  });

  router.get('/service-catalog', requirePlatformAdminRole, async (req, res) => {
    if (req.workspaceOrganization?.kind === 'licensee') {
      // Licensees never edit their service catalog: only RE/Other are exposed
      // when they provision downstream client orgs.
      return res.json({ services: LICENSEE_DOWNSTREAM_SERVICE_CATALOG });
    }
    const platformOrg = await Organization.getOrganization(req.user.organizationId);
    if (!platformOrg || platformOrg.kind !== 'platform') {
      return res.status(404).json({ error: 'Platform organization not found' });
    }
    return res.json({
      services: clientServiceCatalogFromPlatformSettings(platformOrg.settings),
    });
  });

  router.patch('/service-catalog', requirePlatformAdminRole, async (req, res) => {
    if (req.workspaceOrganization?.kind !== 'platform') {
      return res.status(403).json({ error: 'Only platform admins can edit the service catalog' });
    }
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
    const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint);
    const templateTimepointKey = normalizePulseInviteTemplateTimepointKey(timepointPhase);
    return res.json({
      templates: pulseInviteDefaultTemplatesPayload(platformOrg, templateTimepointKey),
      timepoint: internalTimepointToPulseStage(templateTimepointKey),
      placeholders: PULSE_INVITE_TEMPLATE_PLACEHOLDERS,
    });
  });

  router.put('/pulse-link-invites/default-templates', requirePlatformAdminRole, async (req, res) => {
    const platformOrg = await Organization.getOrganization(req.user.organizationId);
    if (!platformOrg || platformOrg.kind !== 'platform') {
      return res.status(404).json({ error: 'Platform organization not found' });
    }
    const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint);
    const templateTimepointKey = normalizePulseInviteTemplateTimepointKey(timepointPhase);
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
    const scopedDefaults = pulseInviteTemplateBucketByTimepoint(existingDefaults, templateTimepointKey);
    const updated = await Organization.updateOrganizationSettings(platformOrg.id, {
      pulseInviteDefaultEmailTemplates: {
        ...existingDefaults,
        [templateTimepointKey]: {
          ...scopedDefaults,
          [audience]: {
            subject,
            bodyHtml,
            updatedAt: new Date().toISOString(),
            updatedByUserId: req.user.id,
          },
        },
      },
    });
    if (!updated || updated.kind !== 'platform') {
      return res.status(404).json({ error: 'Platform organization not found' });
    }
    return res.json({
      templates: pulseInviteDefaultTemplatesPayload(updated, templateTimepointKey),
      timepoint: internalTimepointToPulseStage(templateTimepointKey),
      placeholders: PULSE_INVITE_TEMPLATE_PLACEHOLDERS,
    });
  });

  router.get('/pulse-link-invites/default-survey-start-templates', requirePlatformAdminRole, async (req, res) => {
    const platformOrg = await Organization.getOrganization(req.user.organizationId);
    if (!platformOrg || platformOrg.kind !== 'platform') {
      return res.status(404).json({ error: 'Platform organization not found' });
    }
    const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint);
    const templateTimepointKey = normalizePulseInviteTemplateTimepointKey(timepointPhase);
    return res.json({
      templates: pulseSurveyStartDefaultTemplatesPayload(platformOrg, templateTimepointKey),
      timepoint: internalTimepointToPulseStage(templateTimepointKey),
    });
  });

  router.put('/pulse-link-invites/default-survey-start-templates', requirePlatformAdminRole, async (req, res) => {
    const platformOrg = await Organization.getOrganization(req.user.organizationId);
    if (!platformOrg || platformOrg.kind !== 'platform') {
      return res.status(404).json({ error: 'Platform organization not found' });
    }
    const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint);
    const templateTimepointKey = normalizePulseInviteTemplateTimepointKey(timepointPhase);
    const audience = String(req.body?.audience || '')
      .trim()
      .toLowerCase();
    if (!PULSE_INVITE_TEMPLATE_AUDIENCES.has(audience)) {
      return res.status(400).json({ error: 'audience must be staff or manager' });
    }
    const bodyHtml = surveyStartBodyHtmlFromRequest(req.body);
    if (!stripHtmlToText(bodyHtml)) return res.status(400).json({ error: 'bodyHtml is required' });
    if (bodyHtml.length > PULSE_SURVEY_START_TEMPLATE_MAX_TEXT_LENGTH) {
      return res.status(400).json({
        error: `bodyHtml must be ${PULSE_SURVEY_START_TEMPLATE_MAX_TEXT_LENGTH} characters or less`,
      });
    }
    const existingDefaults =
      platformOrg.settings?.pulseInviteDefaultSurveyStartTemplates
      && typeof platformOrg.settings.pulseInviteDefaultSurveyStartTemplates === 'object'
        ? platformOrg.settings.pulseInviteDefaultSurveyStartTemplates
        : {};
    const scopedDefaults = pulseInviteTemplateBucketByTimepoint(existingDefaults, templateTimepointKey);
    const updated = await Organization.updateOrganizationSettings(platformOrg.id, {
      pulseInviteDefaultSurveyStartTemplates: {
        ...existingDefaults,
        [templateTimepointKey]: {
          ...scopedDefaults,
          [audience]: {
            bodyHtml,
            updatedAt: new Date().toISOString(),
            updatedByUserId: req.user.id,
          },
        },
      },
    });
    if (!updated || updated.kind !== 'platform') {
      return res.status(404).json({ error: 'Platform organization not found' });
    }
    return res.json({
      templates: pulseSurveyStartDefaultTemplatesPayload(updated, templateTimepointKey),
      timepoint: internalTimepointToPulseStage(templateTimepointKey),
    });
  });

  // Welcome email sent to the first admin of a newly created licensee org.
  // Stored on the platform org (global, single-template) so platform admins
  // edit it once and every subsequent licensee creation pulls from it.
  router.get('/licensee-welcome-email-template', requirePlatformAdminRole, async (req, res) => {
    const platformOrg = await Organization.getOrganization(req.user.organizationId);
    if (!platformOrg || platformOrg.kind !== 'platform') {
      return res.status(404).json({ error: 'Platform organization not found' });
    }
    return res.json({
      template: licenseeWelcomeEmailTemplateFromSettings(platformOrg.settings),
      placeholders: LICENSEE_WELCOME_TEMPLATE_PLACEHOLDERS,
    });
  });

  router.put('/licensee-welcome-email-template', requirePlatformAdminRole, async (req, res) => {
    const platformOrg = await Organization.getOrganization(req.user.organizationId);
    if (!platformOrg || platformOrg.kind !== 'platform') {
      return res.status(404).json({ error: 'Platform organization not found' });
    }
    const subject = String(req.body?.subject || '').trim();
    if (!subject) return res.status(400).json({ error: 'subject is required' });
    if (subject.length > LICENSEE_WELCOME_TEMPLATE_MAX_SUBJECT_LENGTH) {
      return res.status(400).json({
        error: `subject must be ${LICENSEE_WELCOME_TEMPLATE_MAX_SUBJECT_LENGTH} characters or less`,
      });
    }
    const bodyHtml = String(req.body?.bodyHtml || '').trim();
    if (!bodyHtml || !stripHtmlToText(bodyHtml)) {
      return res.status(400).json({ error: 'bodyHtml is required' });
    }
    if (bodyHtml.length > LICENSEE_WELCOME_TEMPLATE_MAX_BODY_LENGTH) {
      return res.status(400).json({
        error: `bodyHtml is too long (max ${LICENSEE_WELCOME_TEMPLATE_MAX_BODY_LENGTH} chars)`,
      });
    }
    const updated = await Organization.updateOrganizationSettings(platformOrg.id, {
      licenseeWelcomeEmailTemplate: {
        subject,
        bodyHtml,
        updatedAt: new Date().toISOString(),
        updatedByUserId: req.user.id,
      },
    });
    if (!updated || updated.kind !== 'platform') {
      return res.status(404).json({ error: 'Platform organization not found' });
    }
    return res.json({
      template: licenseeWelcomeEmailTemplateFromSettings(updated.settings),
      placeholders: LICENSEE_WELCOME_TEMPLATE_PLACEHOLDERS,
    });
  });

  router.post('/organizations', requirePlatformAdminRole, handleOrgLogoPlatformUpload, async (req, res) => {
    try {
      const name = req.body.name;
      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'Name is required' });
      }
      const adminEmail = req.body.adminEmail;
      const addrRaw = req.body.companyAddress ?? req.body.address;
      const requesterOrg = req.workspaceOrganization;
      const isLicenseeRequester = requesterOrg?.kind === 'licensee';

      const requestedServiceIds = parseMultipartServiceIds(
        req.body.clientServiceIds ?? req.body['clientServiceIds[]']
      );

      let allowedServiceIds = null;
      let parentOrganizationId = null;
      let createdKind = 'client';

      if (isLicenseeRequester) {
      // Licensees may only provision plain client orgs under themselves and
      // are limited to the locked downstream service catalog (RE/Other).
      parentOrganizationId = requesterOrg.id;
      allowedServiceIds = new Set(LICENSEE_DOWNSTREAM_SERVICE_IDS);
      if (requestedServiceIds && requestedServiceIds.includes(CLIENT_SERVICE_LICENSEE)) {
        return res.status(403).json({
          error: 'Licensees cannot grant the Rhythm Engine Licensee service',
        });
      }
      } else {
      // Platform admins use the full configured catalog. Selecting the
      // licensee service flips the new org into a licensee tenant rooted
      // under this platform org.
      const platformOrg = await Organization.getOrganization(req.user.organizationId);
      const catalog = clientServiceCatalogFromPlatformSettings(platformOrg?.settings);
      allowedServiceIds = new Set(catalog.map((service) => service.id));
      if (
        requestedServiceIds &&
        requestedServiceIds.includes(CLIENT_SERVICE_LICENSEE) &&
        allowedServiceIds.has(CLIENT_SERVICE_LICENSEE)
      ) {
        createdKind = 'licensee';
        parentOrganizationId = platformOrg?.id || null;
      }
    }

      let normalizedServiceIds = null;
      if (requestedServiceIds) {
      normalizedServiceIds = normalizeServiceIds(requestedServiceIds, allowedServiceIds);
      if (normalizedServiceIds == null) {
        return res.status(400).json({ error: 'clientServiceIds must be an array' });
      }
      const invalid = requestedServiceIds.filter((id) => !allowedServiceIds.has(id));
      if (invalid.length) {
        return res.status(400).json({
          error: 'One or more services are not available to this account',
          invalidServiceIds: invalid,
        });
      }
    }

      const initialSettings = {};
      if (addrRaw != null && String(addrRaw).trim()) {
      initialSettings.companyAddress = String(addrRaw).trim();
    }
      if (normalizedServiceIds && normalizedServiceIds.length) {
      initialSettings.services = normalizedServiceIds;
    }

      let org = await Organization.createOrganization(
      name.trim(),
      initialSettings,
      createdKind,
      undefined,
      { parentOrganizationId }
    );
      if (createdKind === 'licensee') {
      try {
        await LicenseConfig.createDefaultForLicensee(org.id);
      } catch (e) {
        console.error('Failed to create licence_config row for licensee org:', e);
      }
    }
      try {
      // Licensee orgs do not run pulse sessions themselves; their own
      // downstream clients each get default sessions when needed.
      if (createdKind === 'client' && organizationHasService(org.settings, CLIENT_SERVICE_PULSE)) {
        await ensureDefaultPulseSessionsForOrg(org.id);
      }
      } catch (e) {
      console.error('Failed to create default pulse sessions for new org:', e);
    }
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
      if (isLicenseeRequester) {
        // Licensee-created client admins are intentionally non-login users.
        sendWelcomeEmail = false;
        enableLogin = false;
      }
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
            if (createdKind === 'licensee') {
              // Pull the editable subject/body from CRM settings (platform org).
              // Falls back to the default template inside sendLicenseeWelcomeEmail
              // if no override has been saved yet.
              const platformOrgForTemplate = await Organization.getOrganization(req.user.organizationId);
              const licenseeTemplate = licenseeWelcomeEmailTemplateFromSettings(
                platformOrgForTemplate?.settings
              );
              await sendLicenseeWelcomeEmail(
                String(adminEmail).trim(),
                displayName,
                loginUrl,
                setPasswordUrl,
                org.name,
                { subject: licenseeTemplate.subject, bodyHtml: licenseeTemplate.bodyHtml }
              );
            } else {
              await sendPlatformWelcomeEmail(
                String(adminEmail).trim(),
                displayName,
                loginUrl,
                setPasswordUrl,
                org.name
              );
            }
            welcomeEmailSent = true;
          } catch (e) {
            console.error('Client first admin welcome email failed:', e);
          }
        }
      }
      auditFromRequest(req)({
        action: AUDIT_ACTIONS.ORG_CREATE,
        targetType: 'organization',
        targetId: org.id,
        targetOrganizationId: org.id,
        metadata: {
          kind: org.kind,
          name: org.name,
          parentOrganizationId: org.parent_organization_id || null,
          firstAdminUserId: outRow?.id || null,
          welcomeEmailSent,
        },
      });
        return res.status(201).json({
        organization: org,
        firstUser: publicStaffUser(outRow),
        welcomeEmailRequested: sendWelcomeEmail,
        welcomeEmailSent,
      });
      }
      auditFromRequest(req)({
      action: AUDIT_ACTIONS.ORG_CREATE,
      targetType: 'organization',
      targetId: org.id,
      targetOrganizationId: org.id,
      metadata: {
        kind: org.kind,
        name: org.name,
        parentOrganizationId: org.parent_organization_id || null,
      },
    });
      res.status(201).json({ organization: org });
    } catch (error) {
      if (error?.code === '23505' && String(error?.constraint || '').toLowerCase().includes('slug')) {
        return res.status(409).json({ error: 'A company with that slug already exists. Try a different name.' });
      }
      console.error('Create organization failed:', error);
      return res.status(500).json({ error: 'Could not create organization.' });
    }
  });

  router.patch('/organizations/:id', requirePlatformAdminRole, async (req, res) => {
    const { name, settings, clientStatus, relationshipStatus } = req.body;
    if (name === undefined && settings === undefined && clientStatus === undefined && relationshipStatus === undefined) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    const requesterOrg = req.workspaceOrganization;
    const isLicenseeRequester = requesterOrg?.kind === 'licensee';
    if (isLicenseeRequester) {
      const owns = await Organization.isClientOrganizationOwnedByParent(
        req.params.id,
        requesterOrg.id
      );
      if (!owns) return res.status(404).json({ error: 'Organization not found' });
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
    let normalizedRelationshipStatus;
    if (relationshipStatus !== undefined) {
      normalizedRelationshipStatus = normalizeRelationshipStatus(relationshipStatus);
      if (!normalizedRelationshipStatus) {
        return res.status(400).json({
          error: 'relationshipStatus must be one of: warm, cold, lost, new, active-campaign',
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
        // The Rhythm Engine Licensee service can only take effect at company
        // creation time, where it flips a brand-new org into a licensee
        // tenant. An existing org's kind never changes after creation, so
        // granting this service here would silently do nothing while
        // implying the client gained licensee/Rhythm Engine access.
        if (
          Array.isArray(settingsPatch.services) &&
          settingsPatch.services.includes(CLIENT_SERVICE_LICENSEE)
        ) {
          return res.status(403).json({
            error: 'The Rhythm Engine Licensee service can only be granted when creating a new company.',
          });
        }
        let allowedServiceIds;
        if (isLicenseeRequester) {
          allowedServiceIds = new Set(LICENSEE_DOWNSTREAM_SERVICE_IDS);
        } else {
          const platformOrg = await Organization.getOrganization(req.user.organizationId);
          const catalog = clientServiceCatalogFromPlatformSettings(platformOrg?.settings);
          allowedServiceIds = new Set(catalog.map((service) => service.id));
        }
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
      relationshipStatus: normalizedRelationshipStatus,
    });
    if (!updated) return res.status(404).json({ error: 'Organization not found' });
    if (
      settingsPatch?.services &&
      organizationHasService(updated.settings, CLIENT_SERVICE_PULSE)
    ) {
      try {
        await ensureDefaultPulseSessionsForOrg(req.params.id);
      } catch (e) {
        console.error('Failed to create default pulse sessions on service enable:', e);
      }
    }
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.ORG_UPDATE,
      targetType: 'organization',
      targetId: updated.id,
      targetOrganizationId: updated.id,
      metadata: {
        kind: updated.kind,
        nameChanged: name !== undefined,
        settingsKeys: settingsPatch ? Object.keys(settingsPatch) : [],
        clientStatusChanged: clientStatus !== undefined,
        relationshipStatusChanged: relationshipStatus !== undefined,
      },
    });
    res.json(updated);
  });

  router.delete('/organizations/:id', requirePlatformAdminRole, async (req, res) => {
    const org = await Organization.getOrganization(req.params.id);
    const requesterOrg = req.workspaceOrganization;
    if (!org || (org.kind !== 'client' && org.kind !== 'licensee')) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    if (requesterOrg?.kind === 'licensee') {
      if (org.kind !== 'client' || org.parent_organization_id !== requesterOrg.id) {
        return res.status(404).json({ error: 'Organization not found' });
      }
    }
    if (org.company_logo_filename) {
      const logoPath = orgLogoFilePath(req.params.id, org.company_logo_filename);
      try {
        fs.unlinkSync(logoPath);
      } catch { /* file may already be gone */ }
    }
    const deleted = await Organization.deleteOrganization(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Organization not found' });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.ORG_DELETE,
      targetType: 'organization',
      targetId: org.id,
      targetOrganizationId: org.parent_organization_id || org.id,
      metadata: {
        kind: org.kind,
        name: org.name,
        parentOrganizationId: org.parent_organization_id || null,
      },
    });
    res.status(204).end();
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

  router.post('/organizations/:id/invites', inviteSendLimiter, requireBodyFields(['email']), async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    const requesterOrg = req.workspaceOrganization;
    const isLicenseeRequester = requesterOrg?.kind === 'licensee';
    const invitedRole = req.body.invitedRole === 'admin' ? 'admin' : 'employee';
    const emailNorm = String(req.body.email || '').trim().toLowerCase();
    const firstName = req.body.firstName;
    const lastName = req.body.lastName;
    const existing = await User.findUserByEmail(emailNorm);

    if (existing) {
      const sameOrg = String(existing.organization_id) === String(org.id);
      if (!existing.deactivated_at || !sameOrg) {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }
      if (invitedRole === 'admin') {
        const config = await LicenseConfig.getForOrganization(org.id);
        if (config) {
          const counts = await User.countActiveUsersByRoleForOrg(org.id);
          if ((counts.admin || 0) + 1 > config.admin_user_limit) {
            return res.status(402).json({
              error: `Admin user limit reached for this licence (${config.admin_user_limit}). Contact the platform owner to raise the limit.`,
            });
          }
        }
      }
      const okRe = await User.reactivateUserInOrg(existing.id, org.id);
      if (!okRe) {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }
      const passwordHash = await bcrypt.hash(randomBytes(32).toString('base64url'), 12);
      await User.updateUserPassword(existing.id, passwordHash);
      await User.updateStaffUserInOrg(existing.id, org.id, {
        firstName,
        lastName,
        role: invitedRole,
        loginEnabled: !isLicenseeRequester,
      });
      const outRow = await User.findUserById(existing.id);
      if (isLicenseeRequester) {
        auditFromRequest(req)({
          action: AUDIT_ACTIONS.USER_INVITE_SEND,
          targetType: 'user',
          targetId: outRow.id,
          targetOrganizationId: org.id,
          metadata: { invitedRole, reactivated: true, createdWithoutInvite: true },
        });
        return res.status(200).json({
          user: publicStaffUser(outRow),
          createdWithoutInvite: true,
          reactivated: true,
        });
      }
      let welcomeEmailSent = false;
      const baseUrl = resolveCrmAppBaseUrl();
      if (baseUrl && isResendConfigured()) {
        try {
          const resetToken = await PasswordResetToken.createResetToken(existing.id, {
            expiresInMs: CLIENT_FIRST_ADMIN_WELCOME_RESET_MS,
          });
          const loginUrl = `${baseUrl}/login`;
          const setPasswordUrl = `${baseUrl}/reset-password/${resetToken}`;
          const displayName = [firstName, lastName]
            .map((s) => String(s || '').trim())
            .filter(Boolean)
            .join(' ');
          await sendPlatformWelcomeEmail(
            emailNorm,
            displayName,
            loginUrl,
            setPasswordUrl,
            org.name
          );
          welcomeEmailSent = true;
        } catch (e) {
          console.error('Client org user reactivation welcome email failed:', e);
        }
      }
      auditFromRequest(req)({
        action: AUDIT_ACTIONS.USER_INVITE_SEND,
        targetType: 'user',
        targetId: outRow.id,
        targetOrganizationId: org.id,
        metadata: { invitedRole, reactivated: true, welcomeEmailSent },
      });
      return res.status(200).json({
        user: publicStaffUser(outRow),
        welcomeEmailSent,
        reactivated: true,
      });
    }

    if (isLicenseeRequester) {
      const passwordHash = await bcrypt.hash(randomBytes(32).toString('base64url'), 12);
      const created = await User.createUserWithProfile({
        email: emailNorm,
        passwordHash,
        role: invitedRole,
        organizationId: org.id,
        firstName,
        lastName,
        loginEnabled: false,
      });
      const outRow = await User.findUserById(created.id);
      return res.status(201).json({
        user: publicStaffUser(outRow),
        createdWithoutInvite: true,
      });
    }
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14);
    const invite = await Invite.createInvite({
      email: emailNorm,
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

  router.post(
    '/organizations/:orgId/users/:userId/resend-welcome-email',
    inviteSendLimiter,
    async (req, res) => {
      const { orgId, userId } = req.params;
      const target = await assertClientUserInOrg(orgId, userId, req.user);
      if (!target) {
        return res.status(404).json({ error: 'User not found' });
      }
      const org = await Organization.getOrganization(orgId);
      if (!org) {
        return res.status(404).json({ error: 'Organization not found' });
      }
      if (target.login_enabled === false) {
        return res.status(400).json({
          error: 'Login is disabled for this user; enable login before sending email.',
        });
      }
      const baseUrl = resolveCrmAppBaseUrl();
      if (!baseUrl) {
        return res.status(400).json({
          error:
            'Set CRM_APP_URL (or APP_URL/FRONTEND_ORIGIN fallback) to send welcome email.',
        });
      }
      if (!isResendConfigured()) {
        return res.status(503).json({
          error: 'Email is not configured',
          details: 'Add RESEND_API_KEY to send welcome email.',
        });
      }
      let welcomeEmailSent = false;
      try {
        const resetToken = await PasswordResetToken.createResetToken(target.id, {
          expiresInMs: CLIENT_FIRST_ADMIN_WELCOME_RESET_MS,
        });
        const loginUrl = `${baseUrl}/login`;
        const setPasswordUrl = `${baseUrl}/reset-password/${resetToken}`;
        const displayName = [target.first_name, target.last_name]
          .map((s) => String(s || '').trim())
          .filter(Boolean)
          .join(' ');
        await sendPlatformWelcomeEmail(
          String(target.email).trim(),
          displayName,
          loginUrl,
          setPasswordUrl,
          org.name
        );
        welcomeEmailSent = true;
      } catch (e) {
        console.error('Client org resend welcome email failed:', e);
      }
      auditFromRequest(req)({
        action: AUDIT_ACTIONS.USER_INVITE_RESEND,
        targetType: 'user',
        targetId: target.id,
        targetOrganizationId: org.id,
        metadata: { welcomeEmailSent },
      });
      res.json({ welcomeEmailSent });
    }
  );

  router.get('/organizations/:id', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    let licenseConfig = null;
    if (org.kind === 'licensee') {
      licenseConfig = await LicenseConfig.publicForOrganization(org.id);
    }
    res.json({ organization: org, licenseConfig });
  });

  router.patch('/organizations/:id/licence-config', requirePlatformAdminRole, async (req, res) => {
    if (req.workspaceOrganization?.kind !== 'platform') {
      return res.status(403).json({ error: 'Only platform admins can edit licence configuration' });
    }
    const org = await Organization.getOrganization(req.params.id);
    if (!org || org.kind !== 'licensee') {
      return res.status(404).json({ error: 'Licensee organization not found' });
    }
    const body = req.body || {};
    const patch = {};
    const allowed = [
      'licenseTier',
      'status',
      'contractStart',
      'contractEnd',
      'assessmentsIncluded',
      'assessmentsConsumed',
      'respondentCapPerAssessment',
      'adminUserLimit',
      'benchmarkAccess',
      'onboardingFeePaid',
      'notes',
      'brandDisplayName',
      'brandPrimaryColor',
      'brandUseForDownstream',
    ];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = body[key];
    }
    if (patch.brandPrimaryColor != null && patch.brandPrimaryColor !== '') {
      const trimmed = String(patch.brandPrimaryColor).trim();
      if (!/^#[0-9a-f]{6}$/i.test(trimmed)) {
        return res.status(400).json({
          error: 'brandPrimaryColor must be a 6-digit hex colour like #0066cc',
        });
      }
      patch.brandPrimaryColor = trimmed;
    } else if (patch.brandPrimaryColor === '') {
      patch.brandPrimaryColor = null;
    }
    if (patch.brandDisplayName != null) {
      const trimmed = String(patch.brandDisplayName).trim();
      patch.brandDisplayName = trimmed === '' ? null : trimmed.slice(0, 120);
    }
    if (patch.brandUseForDownstream != null) {
      patch.brandUseForDownstream = Boolean(patch.brandUseForDownstream);
    }
    if (patch.licenseTier && !LicenseConfig.LICENSE_TIERS.includes(patch.licenseTier)) {
      return res.status(400).json({
        error: `licenseTier must be one of: ${LicenseConfig.LICENSE_TIERS.join(', ')}`,
      });
    }
    if (patch.status && !LicenseConfig.LICENSE_STATUSES.includes(patch.status)) {
      return res.status(400).json({
        error: `status must be one of: ${LicenseConfig.LICENSE_STATUSES.join(', ')}`,
      });
    }
    if (patch.adminUserLimit != null) {
      const n = Number.parseInt(String(patch.adminUserLimit), 10);
      if (!Number.isInteger(n) || n < 1) {
        return res.status(400).json({ error: 'adminUserLimit must be a positive integer' });
      }
      patch.adminUserLimit = n;
    }
    if (patch.assessmentsIncluded != null) {
      const n = Number.parseInt(String(patch.assessmentsIncluded), 10);
      if (!Number.isInteger(n) || n < 0) {
        return res.status(400).json({ error: 'assessmentsIncluded must be a non-negative integer' });
      }
      patch.assessmentsIncluded = n;
    }
    if (patch.assessmentsConsumed != null) {
      const n = Number.parseInt(String(patch.assessmentsConsumed), 10);
      if (!Number.isInteger(n) || n < 0) {
        return res.status(400).json({ error: 'assessmentsConsumed must be a non-negative integer' });
      }
      patch.assessmentsConsumed = n;
    }
    if (patch.respondentCapPerAssessment != null && patch.respondentCapPerAssessment !== '') {
      const n = Number.parseInt(String(patch.respondentCapPerAssessment), 10);
      if (!Number.isInteger(n) || n < 1) {
        return res.status(400).json({
          error: 'respondentCapPerAssessment must be a positive integer or null',
        });
      }
      patch.respondentCapPerAssessment = n;
    } else if (patch.respondentCapPerAssessment === '') {
      patch.respondentCapPerAssessment = null;
    }
    // Ensure a row exists; createDefaultForLicensee is a no-op if it does.
    await LicenseConfig.createDefaultForLicensee(org.id);
    const updated = await LicenseConfig.updateForOrganization(org.id, patch);
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.LICENCE_CONFIG_UPDATE,
      targetType: 'licence_config',
      targetId: org.id,
      targetOrganizationId: org.id,
      metadata: { patchedFields: Object.keys(patch) },
    });
    res.json({ licenseConfig: LicenseConfig.publicLicenseConfig(updated) });
  });

  // INF-03: audit feed scoped to a single org. Platform admins can read
  // any org; licensee admins can read their own org and any owned
  // downstream client. Returns the latest events newest-first, suitable
  // for a "Recent activity" panel.
  router.get('/organizations/:id/audit-events', async (req, res, next) => {
    try {
      const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
      if (!org) return res.status(404).json({ error: 'Organization not found' });
      const limit = Number.parseInt(req.query?.limit, 10) || 50;
      const action = String(req.query?.action || '').trim() || null;
      const rows = await listRecentAuditEvents({
        organizationId: org.id,
        limit,
        action,
      });
      res.json({ events: rows.map(publicAuditEvent) });
    } catch (error) {
      next(error);
    }
  });

  // Static prospect record captured at promotion time — see
  // services/prospectSnapshot.js. Separate from the live audit-events feed
  // above, which keeps growing after promotion.
  router.get('/organizations/:id/prospect-snapshot.csv', async (req, res, next) => {
    try {
      const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
      if (!org) return res.status(404).json({ error: 'Organization not found' });
      if (!org.prospect_snapshot) return res.status(404).json({ error: 'No prospect snapshot for this organization' });
      const csv = prospectSnapshotToCsv(org.prospect_snapshot);
      const safeName = String(org.name || 'client').replace(/[^a-zA-Z0-9-]+/g, '-');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}-prospect-history.csv"`);
      res.status(200).send(csv);
    } catch (error) {
      next(error);
    }
  });

  // INF-11: platform admins can fire the expiry-warning sweep on demand
  // (e.g. after manually adjusting a contract end). The cron path uses
  // the same underlying service.
  router.post('/licence-expiry-sweep', expirySweepManualLimiter, requirePlatformAdminRole, async (req, res, next) => {
    if (req.workspaceOrganization?.kind !== 'platform') {
      return res.status(403).json({ error: 'Only platform admins can run the licence expiry sweep' });
    }
    try {
      const dryRun = String(req.query?.dryRun || '').toLowerCase() === 'true';
      const result = await runLicenseExpirySweep({ dryRun });
      auditFromRequest(req)({
        action: AUDIT_ACTIONS.LICENCE_EXPIRY_SWEEP,
        targetType: 'licence_expiry_sweep',
        metadata: {
          dryRun,
          notificationsSent: result.notificationsSent,
          notificationsSkipped: result.notificationsSkipped,
          errors: result.errors?.length || 0,
        },
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // SUP-01 read-only support impersonation. Mints a short-lived JWT
  // that authenticates as the licensee's first active admin but with a
  // `supportImpersonation` flag so blockSupportWrites refuses any non-
  // GET request. Audit-logged at mint time so we can always prove who
  // looked at what.
  router.post('/organizations/:id/support-impersonate', requirePlatformAdminRole, async (req, res, next) => {
    if (req.workspaceOrganization?.kind !== 'platform') {
      return res.status(403).json({ error: 'Only platform admins can impersonate' });
    }
    try {
      const org = await Organization.getOrganization(req.params.id);
      if (!org || (org.kind !== 'licensee' && org.kind !== 'client')) {
        return res.status(404).json({ error: 'Organization not found' });
      }
      const admins = await User.listUsersForOrg(org.id, { role: 'admin' });
      const target = (admins || []).find((u) => !u.deactivated_at && u.login_enabled !== false);
      if (!target) {
        return res.status(409).json({
          error: 'No active admin user to impersonate. Create one or have the licensee invite an admin first.',
        });
      }
      // Short window — long enough to investigate, too short to forget
      // about. Treat the token like a one-shot session.
      const token = signToken({
        sub: target.id,
        role: target.role,
        organizationId: target.organization_id,
        organizationKind: org.kind,
        supportImpersonation: true,
        supportActorUserId: req.user.id,
        supportTargetOrgId: org.id,
      }, { expiresIn: '30m' });
      auditFromRequest(req)({
        action: AUDIT_ACTIONS.SUPPORT_IMPERSONATE_BEGIN,
        targetType: 'organization',
        targetId: org.id,
        targetOrganizationId: org.id,
        metadata: { impersonatedUserId: target.id, impersonatedUserEmail: target.email },
      });
      res.json({
        token,
        impersonatedUser: { id: target.id, email: target.email, role: target.role },
        organization: { id: org.id, name: org.name, kind: org.kind },
        warning: 'Read-only session. Writes will return 403.',
      });
    } catch (error) {
      next(error);
    }
  });

  // DAT-03 off-board lifecycle. The schedule endpoint suspends the
  // licence immediately and stamps a purge_after date (default 30 days
  // grace). The nightly privacy-maintenance job actually deletes.
  // Cancellation is allowed at any point before purge.
  router.post('/organizations/:id/offboard', offboardLimiter, requirePlatformAdminRole, async (req, res, next) => {
    if (req.workspaceOrganization?.kind !== 'platform') {
      return res.status(403).json({ error: 'Only platform admins can off-board licensees' });
    }
    try {
      const org = await Organization.getOrganization(req.params.id);
      if (!org || org.kind !== 'licensee') {
        return res.status(404).json({ error: 'Licensee not found' });
      }
      const reason = req.body?.reason ? String(req.body.reason).slice(0, 500) : null;
      const graceDays = Number.parseInt(req.body?.graceDays, 10);
      // Make sure a row exists so the UPDATE actually returns a row.
      await LicenseConfig.createDefaultForLicensee(org.id);
      const updated = await LicenseConfig.scheduleOffboard(org.id, {
        reason,
        requestedBy: req.user?.id || null,
        graceDays: Number.isFinite(graceDays) ? graceDays : 30,
      });
      auditFromRequest(req)({
        action: AUDIT_ACTIONS.LICENSEE_OFFBOARD_REQUEST,
        targetType: 'organization',
        targetId: org.id,
        targetOrganizationId: org.id,
        metadata: { reason, purgeAfter: updated?.purge_after, graceDays },
      });
      res.json({ licenseConfig: LicenseConfig.publicLicenseConfig(updated) });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/organizations/:id/offboard', offboardLimiter, requirePlatformAdminRole, async (req, res, next) => {
    if (req.workspaceOrganization?.kind !== 'platform') {
      return res.status(403).json({ error: 'Only platform admins can cancel off-board' });
    }
    try {
      const org = await Organization.getOrganization(req.params.id);
      if (!org || org.kind !== 'licensee') {
        return res.status(404).json({ error: 'Licensee not found' });
      }
      const updated = await LicenseConfig.cancelScheduledOffboard(org.id);
      auditFromRequest(req)({
        action: AUDIT_ACTIONS.LICENSEE_OFFBOARD_CANCEL,
        targetType: 'organization',
        targetId: org.id,
        targetOrganizationId: org.id,
      });
      res.json({ licenseConfig: LicenseConfig.publicLicenseConfig(updated) });
    } catch (error) {
      next(error);
    }
  });

  // DAT-02 portability bundle for a licensee. Platform admins only;
  // returns a single JSON document with org / users / downstream
  // clients / ledger / audit (see licenseeDataExport.js for what's in
  // and out). Licensee admins can also pull their own bundle (used by
  // the off-board flow's "download before deletion" affordance).
  router.get('/organizations/:id/data-export', dataExportLimiter, async (req, res, next) => {
    try {
      const requesterOrg = req.workspaceOrganization;
      const targetOrgId = req.params.id;
      const isPlatformAdmin = requesterOrg?.kind === 'platform' && req.user?.role === 'admin';
      const isOwnLicensee = requesterOrg?.kind === 'licensee' && requesterOrg.id === targetOrgId;
      if (!isPlatformAdmin && !isOwnLicensee) {
        return res.status(403).json({ error: 'Not allowed to export this organisation' });
      }
      const { buildLicenseeDataExport } = await import('../../services/licenseeDataExport.js');
      const bundle = await buildLicenseeDataExport(targetOrgId);
      if (!bundle) return res.status(404).json({ error: 'Licensee not found' });
      auditFromRequest(req)({
        action: AUDIT_ACTIONS.LICENSEE_DATA_EXPORT_DOWNLOAD,
        targetType: 'organization',
        targetId: targetOrgId,
        targetOrganizationId: targetOrgId,
        metadata: { counts: bundle.counts },
      });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="licensee-export-${targetOrgId}.json"`
      );
      res.status(200).send(JSON.stringify(bundle, null, 2));
    } catch (error) {
      next(error);
    }
  });

  // Phase 2 support analytics: per-licensee operational health, plus a
  // bulk variant for the platform-clients page so we don't N+1.
  router.get('/licensee-health', requirePlatformAdminRole, async (req, res, next) => {
    if (req.workspaceOrganization?.kind !== 'platform') {
      return res.status(403).json({ error: 'Only platform admins can read licensee health' });
    }
    try {
      const { getLicenseeHealthSnapshot } = await import('../../services/licenseeHealth.js');
      const items = await getLicenseeHealthSnapshot();
      res.json({ licensees: items });
    } catch (error) {
      next(error);
    }
  });

  router.get('/organizations/:id/licensee-health', requirePlatformAdminRole, async (req, res, next) => {
    if (req.workspaceOrganization?.kind !== 'platform') {
      return res.status(403).json({ error: 'Only platform admins can read licensee health' });
    }
    try {
      const { getLicenseeHealthForOrg } = await import('../../services/licenseeHealth.js');
      const snapshot = await getLicenseeHealthForOrg(req.params.id);
      if (!snapshot) return res.status(404).json({ error: 'Organization not found' });
      res.json({ licensee: snapshot });
    } catch (error) {
      next(error);
    }
  });

  // Phase 2 reconciliation: month-end CSV download for a single
  // licensee. Manual platform-admin trigger; the cron path lives in
  // /api/internal and uses the same builder.
  router.get('/organizations/:id/reconciliation.csv', requirePlatformAdminRole, async (req, res, next) => {
    if (req.workspaceOrganization?.kind !== 'platform') {
      return res.status(403).json({ error: 'Only platform admins can download reconciliation' });
    }
    try {
      const monthIso = String(req.query?.month || '').trim()
        || (await import('../../services/assessmentReconciliation.js')).previousCompletedMonthIso();
      const { buildMonthlyReconciliation } = await import('../../services/assessmentReconciliation.js');
      const report = await buildMonthlyReconciliation(req.params.id, monthIso);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
      res.setHeader('X-Reconciliation-Net-Charged', String(report.summary.netCharged));
      res.setHeader('X-Reconciliation-Event-Count', String(report.summary.eventCount));
      res.setHeader('X-Reconciliation-Distinct-Clients', String(report.summary.distinctClients));
      res.status(200).send(report.csv);
    } catch (error) {
      if (/^month must be|^month out of range|^Not a licensee/.test(String(error?.message || ''))) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  // INF-04: ledger of "assessment opened" events for a licensee. Platform
  // admins use this to audit consumption and reconcile top-ups / refunds.
  router.get('/organizations/:id/assessment-consumption', requirePlatformAdminRole, async (req, res) => {
    if (req.workspaceOrganization?.kind !== 'platform') {
      return res.status(403).json({ error: 'Only platform admins can view assessment consumption' });
    }
    const org = await Organization.getOrganization(req.params.id);
    if (!org || org.kind !== 'licensee') {
      return res.status(404).json({ error: 'Licensee organization not found' });
    }
    const events = await AssessmentConsumptionEvent.listForLicensee(org.id, { limit: 200 });
    res.json({
      events: events.map(AssessmentConsumptionEvent.publicEvent),
      licenseConfig: await LicenseConfig.publicForOrganization(org.id),
    });
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

  router.post('/organizations/:id/logo', brandUploadLimiter, handleOrgLogoPlatformUpload, async (req, res) => {
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
      auditFromRequest(req)({
        action: AUDIT_ACTIONS.ORG_LOGO_UPLOAD,
        targetType: 'organization',
        targetId: org.id,
        targetOrganizationId: org.id,
        metadata: { filename: base },
      });
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
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.ORG_LOGO_DELETE,
      targetType: 'organization',
      targetId: org.id,
      targetOrganizationId: org.id,
      metadata: { previousFilename: prev || null },
    });
    res.json({ organization: updated });
  });

  router.get('/organizations/:id/pulse-sessions', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    let sessions = await PulseSession.listSessionsForOrg(req.params.id);
    if (!sessions.some((s) => DEFAULT_PULSE_SESSION_PURPOSES.includes(s.session_purpose))) {
      try {
        await ensureDefaultPulseSessionsForOrg(req.params.id);
        sessions = await PulseSession.listSessionsForOrg(req.params.id);
      } catch (e) {
        console.error('Failed to lazy-init default pulse sessions:', e);
      }
    }
    res.json({ sessions: sessions.map(publicPulseSessionRow) });
  });

  // INF-05: platform admins can raise (or clear) the respondent cap for an
  // individual pulse_session when overage is commercially agreed. The value
  // is per-session and overrides licence_config.respondent_cap_per_assessment.
  router.patch('/organizations/:id/pulse-sessions/:sessionId/respondent-cap', requirePlatformAdminRole, async (req, res) => {
    if (req.workspaceOrganization?.kind !== 'platform') {
      return res.status(403).json({ error: 'Only platform admins can override respondent caps' });
    }
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const session = await PulseSession.getSessionById(req.params.sessionId, org.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const raw = req.body?.respondentCapOverride;
    let nextCap = null;
    if (raw === null || raw === undefined || raw === '') {
      nextCap = null;
    } else {
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return res.status(400).json({ error: 'respondentCapOverride must be null or a non-negative integer' });
      }
      nextCap = parsed;
    }
    const updated = await PulseSession.setRespondentCapOverride(session.id, org.id, nextCap);
    if (!updated) return res.status(500).json({ error: 'Could not update respondent cap' });
    auditFromRequest(req)({
      action: AUDIT_ACTIONS.PULSE_RESPONDENT_CAP_OVERRIDE,
      targetType: 'pulse_session',
      targetId: session.id,
      targetOrganizationId: org.id,
      metadata: {
        previousCap: session.respondent_cap_override ?? null,
        nextCap,
      },
    });
    res.json({ session: publicPulseSessionRow(updated) });
  });

  // Cosmetic display-date override for the singleton Pre/Post sessions —
  // their created_at is just when the org record was bootstrapped, not the
  // real engagement start/end date, so this lets admins re-label them from
  // the Rhythm Engine Settings screen.
  router.patch(
    '/organizations/:id/pulse-sessions/:sessionId/label-date',
    requirePlatformAdminRole,
    async (req, res) => {
      const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
      if (!org) return res.status(404).json({ error: 'Organization not found' });

      const raw = req.body?.labelDate;
      let labelDate = null;
      if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw).trim())) {
          return res.status(400).json({ error: 'labelDate must be an ISO date (YYYY-MM-DD) or null' });
        }
        labelDate = String(raw).trim();
      }
      const updated = await PulseSession.setLabelDate(req.params.sessionId, org.id, labelDate);
      if (!updated) {
        return res.status(404).json({ error: 'Session not found or not eligible for a custom date' });
      }
      auditFromRequest(req)({
        action: AUDIT_ACTIONS.PULSE_SESSION_LABEL_DATE_UPDATE,
        targetType: 'pulse_session',
        targetId: updated.id,
        targetOrganizationId: org.id,
        metadata: { labelDate },
      });
      res.json({ session: publicPulseSessionRow(updated) });
    }
  );

  router.post('/organizations/:id/pulse-timepoints/during', requirePlatformAdminRole, async (req, res, next) => {
    try {
      const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
      if (!org) return res.status(404).json({ error: 'Organization not found' });
      if (!organizationHasService(org.settings, CLIENT_SERVICE_PULSE)) {
        return res.status(403).json({ error: 'Rhythm Engine is not enabled for this client' });
      }

      // INF-04: charge one assessment against the parent licensee (if any)
      // before any pulse_session insert. This is atomic via licence_config
      // conditional UPDATE so concurrent requests can't both succeed at
      // quota = N + 1.
      const meter = await consumeAssessmentForClient(org, {
        source: SOURCE_PLATFORM_DURING_CHECKPOINT,
        actorUserId: req.user?.id || null,
        metadata: { route: 'platform.during_checkpoint' },
      });
      if (meter.metered && !meter.ok) {
        return res.status(meter.status).json({
          error: meter.error,
          reason: meter.reason,
          licenseConfig: LicenseConfig.publicLicenseConfig(meter.licenseConfig),
        });
      }

      const name = createDuringPulseCheckpointName(new Date());
      let staffSession;
      let managerSession;
      try {
        [staffSession, managerSession] = await Promise.all([
          createFreshActiveDuringSession(org.id, name, 'staff'),
          createFreshActiveDuringSession(org.id, name, 'manager'),
        ]);
      } catch (error) {
        // Refund the meter charge if the underlying session inserts blew up
        // so the licensee isn't charged for a checkpoint that never opened.
        if (meter.metered && meter.ok) {
          try {
            await refundAssessmentForLicensee({
              licenseeOrganizationId: meter.licensee.id,
              clientOrganizationId: org.id,
              actorUserId: req.user?.id || null,
              metadata: {
                route: 'platform.during_checkpoint',
                reason: 'session_insert_failed',
                error: error?.code || error?.message || 'unknown',
              },
            });
          } catch (refundError) {
            console.error('Failed to refund assessment after checkpoint failure:', refundError);
          }
        }
        throw error;
      }

      auditFromRequest(req)({
        action: AUDIT_ACTIONS.PULSE_DURING_CHECKPOINT_OPEN,
        targetType: 'pulse_session',
        targetId: staffSession.id,
        targetOrganizationId: org.id,
        metadata: {
          checkpointDate: pulseSessionDateKey(staffSession),
          staffSessionId: staffSession.id,
          managerSessionId: managerSession.id,
          metered: meter.metered,
          licenseeOrganizationId: meter.licensee?.id || null,
        },
      });
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

  // Rhythm Engine settings: platform admins only, matching the settings
  // panel that owns During checkpoint creation/deletion. Soft-deletes the
  // selected checkpoint and its paired staff/manager session so it drops
  // out of the Point in Time selector and dashboards, without losing the
  // underlying session/response rows.
  router.delete(
    '/organizations/:id/pulse-timepoints/during/:sessionId',
    requirePlatformAdminRole,
    async (req, res) => {
      const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
      if (!org) return res.status(404).json({ error: 'Organization not found' });
      if (!organizationHasService(org.settings, CLIENT_SERVICE_PULSE)) {
        return res.status(403).json({ error: 'Rhythm Engine is not enabled for this client' });
      }

      const sessions = await PulseSession.listSessionsForOrg(org.id);
      const pair = pairedDuringSessionsForSelection(sessions, req.params.sessionId);
      if (pair.length === 0) {
        return res.status(404).json({ error: 'During checkpoint not found' });
      }

      const deleted = [];
      for (const session of pair) {
        const updated = await PulseSession.softDeleteDuringSession(session.id, org.id, {
          actorUserId: req.user?.id || null,
          metadata: { route: 'platform.during_checkpoint.delete' },
        });
        if (updated) deleted.push(updated);
      }
      if (deleted.length === 0) {
        return res.status(404).json({ error: 'During checkpoint not found' });
      }

      auditFromRequest(req)({
        action: AUDIT_ACTIONS.PULSE_DURING_CHECKPOINT_DELETE,
        targetType: 'pulse_session',
        targetId: req.params.sessionId,
        targetOrganizationId: org.id,
        metadata: {
          checkpointDate: pulseSessionDateKey(deleted[0]),
          deletedSessionIds: deleted.map((s) => s.id),
        },
      });
      return res.json({ deletedSessionIds: deleted.map((s) => s.id) });
    }
  );

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
        groupValues: Array.isArray(r.group_level_values) ? r.group_level_values : [],
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
      ? (() => {
          const paired = pairedDuringSessionsForSelection(timepointFiltered, requestedDuringSessionId);
          return paired.length > 0
            ? paired
            : timepointFiltered.filter((s) => String(s.id) === requestedDuringSessionId);
        })()
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
    } else {
      invitedEmployees += pulseLinkStaff;
      invitedManagers += pulseLinkManager;
    }
    const pulseLinkInvitedCount = pulseLinkStaff + pulseLinkManager;
    const completedTotal = completedRows.length;
    invitedEmployees = Math.max(invitedEmployees, completedEmployeeResponses);
    invitedManagers = Math.max(invitedManagers, completedManagerResponses);
    const invitedTotal = invitedEmployees + invitedManagers;

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

    const employeeScoredRows = completedScoredRows.filter((entry) => entry.role !== 'admin');
    const managerScoredRows = completedScoredRows.filter((entry) => entry.role === 'admin');
    const averageFor = (values) => {
      if (!values.length) return null;
      return round1(values.reduce((sum, value) => sum + value, 0) / values.length);
    };
    const questionAveragesFor = (rows, questionIds = []) => questionIds.map((questionId) => {
      const values = rows
        .map((entry) => entry?.scored?.answers?.[questionId])
        .filter(Number.isFinite);
      return averageFor(values);
    });

    const dimensions = DIMENSIONS.map((dimension) => {
      const employeeDimensionValues = employeeScoredRows
        .map((entry) => entry.scored.dimensions.find((d) => d.id === dimension.id))
        .filter(Boolean)
        .map((d) => d.average)
        .filter(Number.isFinite);
      const managerDimensionValues = managerScoredRows
        .map((entry) => entry.scored.dimensions.find((d) => d.id === dimension.id))
        .filter(Boolean)
        .map((d) => d.average)
        .filter(Number.isFinite);

      const [employeeQ1Avg, employeeQ2Avg] = questionAveragesFor(
        employeeScoredRows,
        dimension.employeeQuestions
      );
      const [managerQ1Avg, managerQ2Avg] = questionAveragesFor(
        managerScoredRows,
        dimension.managerQuestions
      );

      const employeeAvg = averageFor(employeeDimensionValues);
      const managerAvg = averageFor(managerDimensionValues);
      const employeeIntraGap =
        Number.isFinite(employeeQ1Avg) && Number.isFinite(employeeQ2Avg)
          ? round1(Math.abs(employeeQ1Avg - employeeQ2Avg))
          : null;
      const managerIntraGap =
        Number.isFinite(managerQ1Avg) && Number.isFinite(managerQ2Avg)
          ? round1(Math.abs(managerQ1Avg - managerQ2Avg))
          : null;
      const comparable = !NON_COMPARABLE_DIMENSION_IDS.has(dimension.id);
      const perceptionGap =
        comparable && Number.isFinite(employeeAvg) && Number.isFinite(managerAvg)
          ? round1(Math.abs(employeeAvg - managerAvg))
          : null;

      const employeeHighCount = employeeDimensionValues.filter((value) => value >= 4).length;
      const managerHighCount = managerDimensionValues.filter((value) => value >= 4).length;

      return {
        id: dimension.id,
        label: dimension.employeeLabel,
        managerLabel: dimension.managerLabel,
        comparable,
        employee: {
          questionIds: dimension.employeeQuestions,
          q1Avg: employeeQ1Avg,
          q2Avg: employeeQ2Avg,
          average: employeeAvg,
          count: employeeDimensionValues.length,
          intraGap: employeeIntraGap,
          intraGapFlagged:
            Number.isFinite(employeeIntraGap)
            && employeeIntraGap >= INTRA_DIMENSION_DIVERGENCE_THRESHOLD,
        },
        manager: {
          questionIds: dimension.managerQuestions,
          q1Avg: managerQ1Avg,
          q2Avg: managerQ2Avg,
          average: managerAvg,
          count: managerDimensionValues.length,
          intraGap: managerIntraGap,
          intraGapFlagged:
            Number.isFinite(managerIntraGap)
            && managerIntraGap >= INTRA_DIMENSION_DIVERGENCE_THRESHOLD,
        },
        perceptionGap,
        perceptionGapFlagged:
          Number.isFinite(perceptionGap) && perceptionGap >= PERCEPTION_GAP_THRESHOLD,
        energyAvg: employeeAvg,
        frictionAvg: managerAvg,
        highEnergyPercent:
          employeeDimensionValues.length > 0
            ? round1((employeeHighCount / employeeDimensionValues.length) * 100)
            : 0,
        managerHighPercent:
          managerDimensionValues.length > 0
            ? round1((managerHighCount / managerDimensionValues.length) * 100)
            : 0,
      };
    });

    const trendRows = [];

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

      return {
        managerId: manager.id,
        managerName: manager.displayName || manager.email,
        managerEmail: manager.email,
        directReportInvitedCount: inviteRows.filter((r) => r.manager_invite_id === manager.id).length,
        directReportCompletedCount: completedRows.filter(
          (row) => row.manager_invite_id === manager.id && row.invite_id !== manager.id
        ).length,
        completedResponses: managerCompletedRows.length,
        adoptionScore: managerAdoption,
        sponsorshipScore: managerSponsorship,
        quadrant: managerQuadrant,
        managerLoadBand: loadBand,
        trend: [],
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
          adoptionScore: scored.adoption,
          sponsorshipScore: scored.sponsorship,
          loadScore,
          loadBand,
          chainState,
        };
      })
      .filter(Boolean);

    const managerRespondentCount = managerSelfMetrics.length;
    const managerAdoptionAvg =
      managerRespondentCount > 0
        ? round1(
            managerSelfMetrics.reduce((sum, row) => sum + row.adoptionScore, 0) / managerRespondentCount
          )
        : null;
    const managerSponsorshipAvg =
      managerRespondentCount > 0
        ? round1(
            managerSelfMetrics.reduce((sum, row) => sum + row.sponsorshipScore, 0) / managerRespondentCount
          )
        : null;
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
      const fallbackTeamName = manager.displayName || manager.email || managerId;
      return {
        teamName: teamNameFromGroupValues(manager.groupValues, fallbackTeamName),
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
      header: {
        clientName: org.name,
        stage: requestedTimepoint,
        threshold: READINESS_THRESHOLD,
        managerCount: managerRespondentCount,
        managerAdoptionScore: managerAdoptionAvg,
        managerSponsorshipScore: managerSponsorshipAvg,
      },
      subScores: {
        received: { avg: receivedAvg, threshold: sponsorshipConfig.receivedThreshold },
        capacity: { avg: capacityAvg, threshold: sponsorshipConfig.capacityThreshold },
      },
      load: { bands: loadBandsV3 },
      chain: { states: chainStates },
      crossMatrix: { rows: crossMatrixRows },
      teams: { rows: sortedTeamRows, shownRows: teamRowsLimited },
    });
    const sponsorshipAnalysis = {
      verdict: {
        state: interventionRequired ? 'failed' : 'functioning',
        headline: verdictHeadline,
        body: verdictBody,
        badge: interventionRequired ? 'Intervention Required' : 'Monitoring',
        badgeVariant: interventionRequired ? 'red' : 'amber',
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
        cardLabel: 'AVG SCORE OVERVIEW · MANAGER COHORT ONLY',
        explainer:
          'The two average scores shown here reflect the manager cohort only and will differ from organisation-wide figures. Avg Adoption Score (0-40) measures whether the management layer has the capability, capacity, change track record, and upward enablement to absorb and drive the change across their teams. Avg Sponsorship Score (0-40) measures whether managers are both receiving credible sponsorship from senior leadership above them and have the capacity to sponsor their own teams below. A score of 28 or above in either dimension indicates HIGH classification. Both scores must be HIGH for the management layer to be considered ready.',
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
          critical: band.name === 'Overloaded' && band.percent > 10,
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
        cardLabel: `Section 4 — Team-Level Sponsorship Chain Breakdown · Showing ${teamRowsLimited.length} of ${sortedTeamRows.length} teams`,
        explainer:
          'Maps the sponsorship chain state to each team — distinguishing teams with local failure from those experiencing the broader organisational pattern, and identifying which teams require targeted pre-launch engagement.',
        rows: teamRowsLimited,
        totalRows: sortedTeamRows.length,
      },
      signals: sponsorshipConfig.aiSignalsEnabled ? sponsorshipSignals : null,
    };
    const currentQuadrantForScoreCards =
      adoptionScore != null && sponsorshipScore != null
        ? quadrantLabel(adoptionScore, sponsorshipScore)
        : [...quadrants].sort((a, b) => (Number(b?.percent) || 0) - (Number(a?.percent) || 0))[0]?.name || null;
    const modalQuadrantForScoreCards =
      [...quadrants].sort((a, b) => (Number(b?.percent) || 0) - (Number(a?.percent) || 0))[0]?.name || null;
    const scoreCardSignals = buildTopScoreCardSignals({
      clientName: org.name,
      adoptionScore,
      sponsorshipScore,
      threshold: READINESS_THRESHOLD,
      receivedScore: receivedAvg,
      capacityScore: capacityAvg,
      subScoreThreshold: sponsorshipConfig.receivedThreshold,
      currentQuadrant: currentQuadrantForScoreCards,
      modalQuadrant: modalQuadrantForScoreCards,
      assessmentStage: normalizeAssessmentStageLabel(requestedTimepoint),
      respondentCount: completedTotal,
    });

    const previousWaveAdoptionScore = trendRows.length >= 2 ? trendRows[1].adoptionScore : null;
    const previousWaveSponsorshipScore = trendRows.length >= 2 ? trendRows[1].sponsorshipScore : null;
    const adoptionDelta = scoreDelta(adoptionScore, previousWaveAdoptionScore);
    const sponsorshipDelta = scoreDelta(sponsorshipScore, previousWaveSponsorshipScore);
    const launchVerdict = verdictForScores(adoptionScore, sponsorshipScore, READINESS_THRESHOLD);
    const launchHeadline = headlineForVerdict(launchVerdict);
    const launchStatusLabel = launchVerdict === 'cleared' ? 'Cleared to Launch' : 'Not Cleared';
    const likelihoodSignal = buildLikelihoodWhatThisMeansSignal({
      currentQuadrant: currentQuadrantForScoreCards,
      optimalPct: quadrants.find((entry) => entry.name === 'Optimal')?.percent || 0,
      motivatedLostPct: quadrants.find((entry) => entry.name === 'Motivated but Lost')?.percent || 0,
      capableWaryPct: quadrants.find((entry) => entry.name === 'Capable but Wary')?.percent || 0,
      highRiskPct: quadrants.find((entry) => entry.name === 'High Risk')?.percent || 0,
      launchStatus: launchStatusLabel,
    });
    const quadrantSignal = buildQuadrantExplanationSignal({
      optimalPct: quadrants.find((entry) => entry.name === 'Optimal')?.percent || 0,
      motivatedLostPct: quadrants.find((entry) => entry.name === 'Motivated but Lost')?.percent || 0,
      capableWaryPct: quadrants.find((entry) => entry.name === 'Capable but Wary')?.percent || 0,
      highRiskPct: quadrants.find((entry) => entry.name === 'High Risk')?.percent || 0,
      adoptionScore,
      sponsorshipScore,
      threshold: READINESS_THRESHOLD,
      currentQuadrant: currentQuadrantForScoreCards,
    });
    const quadrantSignalContext = {
      clientName: org.name || null,
      assessmentStage: normalizeAssessmentStageLabel(requestedTimepoint),
      respondentCount: completedTotal,
      orgQuadrant: currentQuadrantForScoreCards,
      largestDeficitQuadrant: quadrantSignal.largestDeficitName,
      largestDeficitPct: quadrantSignal.largestDeficitPct,
      optimalPct: quadrantSignal.optimalPct,
    };

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
    const soWhatFallback = SCORE_CARD_SIGNAL_PROMPTS.likelihood.fallback;
    const aiRenderDeadlineMs = readPositiveIntEnv('CLAUDE_SUMMARY_RENDER_DEADLINE_MS', 350);
    let soWhat = soWhatFallback;
    let soWhatStatus = 'fallback';
    const soWhatAttempt = await runWithDeadline(
      () => generatePulseSoWhatSummary({
        orgName: org.name,
        completedTotal,
        adoptionScore,
        sponsorshipScore,
        threshold: READINESS_THRESHOLD,
        optimalPercent: optimalQuadrant?.percent || 0,
        highRiskPercent: highRiskQuadrant?.percent || 0,
        overloadedPercent: overloadedBand?.percent || 0,
        alertTitles: prioritizedAlerts.alerts.map((alert) => alert.title),
      }),
      aiRenderDeadlineMs
    );
    if (soWhatAttempt.value) {
      soWhat = soWhatAttempt.value;
      soWhatStatus = 'ready';
    } else if (soWhatAttempt.timedOut) {
      soWhatStatus = 'timeout';
    } else if (soWhatAttempt.error) {
      soWhatStatus = 'unavailable';
    }

    const perceptionGapMinSamples = PERCEPTION_GAP_ANALYSIS_MIN_SAMPLES;
    const perceptionGapSampleSizeMet =
      employeeScoredRows.length >= perceptionGapMinSamples
      && managerScoredRows.length >= perceptionGapMinSamples;
    const perceptionGapFlaggedItems = perceptionGapSampleSizeMet
      ? buildPerceptionGapFlaggedItems({
        dimensions,
        threshold: PERCEPTION_GAP_THRESHOLD,
      })
      : [];
    const perceptionGapAiDeadlineMs = readPositiveIntEnv(
      'CLAUDE_PERCEPTION_GAP_RENDER_DEADLINE_MS',
      1500
    );
    let perceptionGapText = null;
    let perceptionGapSource = 'none';
    if (!perceptionGapSampleSizeMet) {
      perceptionGapSource = 'suppressed';
    } else if (perceptionGapFlaggedItems.length === 0) {
      perceptionGapSource = 'none';
    } else {
      const fallbackNarrative = buildPerceptionGapFallbackNarrative({
        items: perceptionGapFlaggedItems,
        threshold: PERCEPTION_GAP_THRESHOLD,
      });
      perceptionGapText = fallbackNarrative;
      perceptionGapSource = 'fallback';
      const perceptionGapAttempt = await runWithDeadline(
        () => requestPerceptionGapAiNarrative({
          orgName: org.name,
          items: perceptionGapFlaggedItems,
          threshold: PERCEPTION_GAP_THRESHOLD,
          employeeCount: employeeScoredRows.length,
          managerCount: managerScoredRows.length,
        }),
        perceptionGapAiDeadlineMs
      );
      if (perceptionGapAttempt.value) {
        perceptionGapText = perceptionGapAttempt.value;
        perceptionGapSource = 'ai';
      }
    }
    const perceptionGapAnalysis = {
      threshold: PERCEPTION_GAP_THRESHOLD,
      minSampleSize: perceptionGapMinSamples,
      sampleSizeMet: perceptionGapSampleSizeMet,
      employeeCount: employeeScoredRows.length,
      managerCount: managerScoredRows.length,
      flaggedCount: perceptionGapFlaggedItems.length,
      flagged: perceptionGapFlaggedItems,
      source: perceptionGapSource,
      text: perceptionGapText,
    };

    const executiveSummary = buildExecutiveSummaryContent({
      adoptionScore,
      sponsorshipScore,
      sponsorshipDelta,
      threshold: READINESS_THRESHOLD,
      optimalPercent: optimalQuadrant?.percent || 0,
      highRiskPercent: highRiskQuadrant?.percent || 0,
      overloadedPercent: overloadedBand?.percent || 0,
      criticalLoadPercent: managerLoad.bands
        .filter((band) => band.name === 'At Capacity' || band.name === 'Overloaded')
        .reduce((sum, band) => sum + (band.percent || 0), 0),
      interventionRequired:
        (sponsorshipScore != null && sponsorshipScore < READINESS_THRESHOLD)
        || ((overloadedBand?.percent || 0) > 10)
        || ((optimalQuadrant?.percent || 0) < 25),
      completedTotal,
    });

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
          ratio(completedEmployeeResponses, invitedEmployees) * 100
        ),
        managerParticipationRate: round1(
          ratio(completedManagerResponses, invitedManagers) * 100
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
      perceptionGapAnalysis,
      scoreCardSignals,
      likelihoodSignal,
      quadrantSignal: { ...quadrantSignal, context: quadrantSignalContext },
      alerts: prioritizedAlerts.alerts,
      alertsOverflowCount: prioritizedAlerts.overflowCount,
      narrative: soWhat,
      soWhat,
      soWhatStatus,
      executiveSummary,
    });
  });

  router.post('/organizations/:id/pulse-trend-signals', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const selectedTimepoint = String(req.body?.selectedTimepoint || '').trim().toLowerCase();
    const inputStages = Array.isArray(req.body?.stages) ? req.body.stages : [];
    const stages = inputStages
      .map((stage) => ({
        key: String(stage?.key || ''),
        label: String(stage?.label || ''),
        available: Boolean(stage?.available),
        adoptionScore: Number.isFinite(stage?.adoptionScore) ? stage.adoptionScore : null,
        sponsorshipScore: Number.isFinite(stage?.sponsorshipScore) ? stage.sponsorshipScore : null,
        quadrant: String(stage?.quadrant || '--'),
        receivedAvg: Number.isFinite(stage?.receivedAvg) ? stage.receivedAvg : null,
        capacityAvg: Number.isFinite(stage?.capacityAvg) ? stage.capacityAvg : null,
        loadBands: stage?.loadBands && typeof stage.loadBands === 'object' ? stage.loadBands : {},
        chainStates: stage?.chainStates && typeof stage.chainStates === 'object' ? stage.chainStates : {},
        dimensions: stage?.dimensions && typeof stage.dimensions === 'object'
          ? stage.dimensions
          : { employee: {}, manager: {} },
        employeeSponsorshipAvg: Number.isFinite(stage?.employeeSponsorshipAvg) ? stage.employeeSponsorshipAvg : null,
        managerSponsorshipAvg: Number.isFinite(stage?.managerSponsorshipAvg) ? stage.managerSponsorshipAvg : null,
        perceptionGap: Number.isFinite(stage?.perceptionGap) ? stage.perceptionGap : null,
      }))
      .filter((stage) => stage.key && stage.label);

    const result = await generatePulseTrendSignals({
      orgName: org.name,
      selectedTimepoint,
      stages,
    });

    res.json({
      source: result.source,
      signals: result.signals,
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
    const dueDate = pulseInviteDueDateForScope(org.settings, timepointPhase, duringSessionId);
    res.json({ invites: rows.map(PulseLinkInvite.publicInviteRow), dueDate });
  });

  router.get('/organizations/:id/pulse-link-invites/templates', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint);
    const templateTimepointKey = normalizePulseInviteTemplateTimepointKey(timepointPhase);
    const duringSessionId = parsePulseInviteDuringSessionId(req.query?.duringSessionId);
    const duringSessionError = validatePulseInviteDuringSession(timepointPhase, duringSessionId);
    if (duringSessionError) return res.status(400).json({ error: duringSessionError });
    const platformOrg = await Organization.getOrganization(req.user.organizationId);
    res.json({
      templates: pulseInviteTemplatesPayload(org, platformOrg?.settings, templateTimepointKey),
      timepoint: internalTimepointToPulseStage(templateTimepointKey),
      placeholders: PULSE_INVITE_TEMPLATE_PLACEHOLDERS,
    });
  });

  router.put('/organizations/:id/pulse-link-invites/templates', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint);
    const templateTimepointKey = normalizePulseInviteTemplateTimepointKey(timepointPhase);
    const duringSessionId = parsePulseInviteDuringSessionId(req.query?.duringSessionId);
    const duringSessionError = validatePulseInviteDuringSession(timepointPhase, duringSessionId);
    if (duringSessionError) return res.status(400).json({ error: duringSessionError });
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
    const scopedTemplates = pulseInviteTemplateBucketByTimepoint(existingTemplates, templateTimepointKey);
    const updated = await Organization.updateOrganizationSettings(org.id, {
      pulseInviteEmailTemplates: {
        ...existingTemplates,
        [templateTimepointKey]: {
          ...scopedTemplates,
          [audience]: {
            subject,
            bodyHtml,
            updatedAt: new Date().toISOString(),
            updatedByUserId: req.user.id,
          },
        },
      },
    });
    if (!updated) return res.status(404).json({ error: 'Organization not found' });
    const platformOrg = await Organization.getOrganization(req.user.organizationId);
    res.json({
      templates: pulseInviteTemplatesPayload(updated, platformOrg?.settings, templateTimepointKey),
      timepoint: internalTimepointToPulseStage(templateTimepointKey),
      placeholders: PULSE_INVITE_TEMPLATE_PLACEHOLDERS,
    });
  });

  router.post('/organizations/:id/pulse-link-invites/templates/reset-default', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint);
    const templateTimepointKey = normalizePulseInviteTemplateTimepointKey(timepointPhase);
    const duringSessionId = parsePulseInviteDuringSessionId(req.query?.duringSessionId);
    const duringSessionError = validatePulseInviteDuringSession(timepointPhase, duringSessionId);
    if (duringSessionError) return res.status(400).json({ error: duringSessionError });
    const audience = String(req.body?.audience || '')
      .trim()
      .toLowerCase();
    if (!PULSE_INVITE_TEMPLATE_AUDIENCES.has(audience)) {
      return res.status(400).json({ error: 'audience must be staff or manager' });
    }
    const platformOrg = await Organization.getOrganization(req.user.organizationId);
    const resetTemplate = pulseInviteDefaultTemplateFromSettings(
      platformOrg?.settings,
      audience,
      org.name,
      templateTimepointKey
    );
    const existingTemplates =
      org.settings?.pulseInviteEmailTemplates && typeof org.settings.pulseInviteEmailTemplates === 'object'
        ? org.settings.pulseInviteEmailTemplates
        : {};
    const scopedTemplates = pulseInviteTemplateBucketByTimepoint(existingTemplates, templateTimepointKey);
    const updated = await Organization.updateOrganizationSettings(org.id, {
      pulseInviteEmailTemplates: {
        ...existingTemplates,
        [templateTimepointKey]: {
          ...scopedTemplates,
          [audience]: {
            subject: resetTemplate.subject,
            bodyHtml: resetTemplate.bodyHtml,
            updatedAt: new Date().toISOString(),
            updatedByUserId: req.user.id,
          },
        },
      },
    });
    if (!updated) return res.status(404).json({ error: 'Organization not found' });
    return res.json({
      templates: pulseInviteTemplatesPayload(updated, platformOrg?.settings, templateTimepointKey),
      timepoint: internalTimepointToPulseStage(templateTimepointKey),
      placeholders: PULSE_INVITE_TEMPLATE_PLACEHOLDERS,
    });
  });

  router.get('/organizations/:id/pulse-link-invites/survey-start-templates', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint);
    const templateTimepointKey = normalizePulseInviteTemplateTimepointKey(timepointPhase);
    const duringSessionId = parsePulseInviteDuringSessionId(req.query?.duringSessionId);
    const duringSessionError = validatePulseInviteDuringSession(timepointPhase, duringSessionId);
    if (duringSessionError) return res.status(400).json({ error: duringSessionError });
    const platformOrg = await Organization.getOrganization(req.user.organizationId);
    return res.json({
      templates: pulseSurveyStartTemplatesPayload(org, platformOrg?.settings, templateTimepointKey),
      timepoint: internalTimepointToPulseStage(templateTimepointKey),
    });
  });

  router.put('/organizations/:id/pulse-link-invites/survey-start-templates', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint);
    const templateTimepointKey = normalizePulseInviteTemplateTimepointKey(timepointPhase);
    const duringSessionId = parsePulseInviteDuringSessionId(req.query?.duringSessionId);
    const duringSessionError = validatePulseInviteDuringSession(timepointPhase, duringSessionId);
    if (duringSessionError) return res.status(400).json({ error: duringSessionError });
    const audience = String(req.body?.audience || '')
      .trim()
      .toLowerCase();
    if (!PULSE_INVITE_TEMPLATE_AUDIENCES.has(audience)) {
      return res.status(400).json({ error: 'audience must be staff or manager' });
    }
    const bodyHtml = surveyStartBodyHtmlFromRequest(req.body);
    if (!stripHtmlToText(bodyHtml)) return res.status(400).json({ error: 'bodyHtml is required' });
    if (bodyHtml.length > PULSE_SURVEY_START_TEMPLATE_MAX_TEXT_LENGTH) {
      return res.status(400).json({
        error: `bodyHtml must be ${PULSE_SURVEY_START_TEMPLATE_MAX_TEXT_LENGTH} characters or less`,
      });
    }
    const existingTemplates =
      org.settings?.pulseInviteSurveyStartTemplates
      && typeof org.settings.pulseInviteSurveyStartTemplates === 'object'
        ? org.settings.pulseInviteSurveyStartTemplates
        : {};
    const scopedTemplates = pulseInviteTemplateBucketByTimepoint(existingTemplates, templateTimepointKey);
    const updated = await Organization.updateOrganizationSettings(org.id, {
      pulseInviteSurveyStartTemplates: {
        ...existingTemplates,
        [templateTimepointKey]: {
          ...scopedTemplates,
          [audience]: {
            bodyHtml,
            updatedAt: new Date().toISOString(),
            updatedByUserId: req.user.id,
          },
        },
      },
    });
    if (!updated) return res.status(404).json({ error: 'Organization not found' });
    const platformOrg = await Organization.getOrganization(req.user.organizationId);
    return res.json({
      templates: pulseSurveyStartTemplatesPayload(updated, platformOrg?.settings, templateTimepointKey),
      timepoint: internalTimepointToPulseStage(templateTimepointKey),
    });
  });

  router.post('/organizations/:id/pulse-link-invites/survey-start-templates/reset-default', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint);
    const templateTimepointKey = normalizePulseInviteTemplateTimepointKey(timepointPhase);
    const duringSessionId = parsePulseInviteDuringSessionId(req.query?.duringSessionId);
    const duringSessionError = validatePulseInviteDuringSession(timepointPhase, duringSessionId);
    if (duringSessionError) return res.status(400).json({ error: duringSessionError });
    const audience = String(req.body?.audience || '')
      .trim()
      .toLowerCase();
    if (!PULSE_INVITE_TEMPLATE_AUDIENCES.has(audience)) {
      return res.status(400).json({ error: 'audience must be staff or manager' });
    }
    const platformOrg = await Organization.getOrganization(req.user.organizationId);
    const resetTemplate = pulseSurveyStartDefaultTemplateFromSettings(
      platformOrg?.settings,
      audience,
      templateTimepointKey
    );
    const existingTemplates =
      org.settings?.pulseInviteSurveyStartTemplates
      && typeof org.settings.pulseInviteSurveyStartTemplates === 'object'
        ? org.settings.pulseInviteSurveyStartTemplates
        : {};
    const scopedTemplates = pulseInviteTemplateBucketByTimepoint(existingTemplates, templateTimepointKey);
    const updated = await Organization.updateOrganizationSettings(org.id, {
      pulseInviteSurveyStartTemplates: {
        ...existingTemplates,
        [templateTimepointKey]: {
          ...scopedTemplates,
          [audience]: {
            bodyHtml: resetTemplate.bodyHtml,
            updatedAt: new Date().toISOString(),
            updatedByUserId: req.user.id,
          },
        },
      },
    });
    if (!updated) return res.status(404).json({ error: 'Organization not found' });
    return res.json({
      templates: pulseSurveyStartTemplatesPayload(updated, platformOrg?.settings, templateTimepointKey),
      timepoint: internalTimepointToPulseStage(templateTimepointKey),
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
    const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint);
    const duringSessionId = parsePulseInviteDuringSessionId(req.query?.duringSessionId);
    const duringSessionError = validatePulseInviteDuringSession(timepointPhase, duringSessionId);
    if (duringSessionError) return res.status(400).json({ error: duringSessionError });
    const pulseBaseUrl = resolvePulseAppBaseUrl();
    const inviteStage = internalTimepointToPulseStage(timepointPhase);
    const testLink = pulseBaseUrl
      ? `${pulseBaseUrl}/rhythm-engine/${inviteStage}/link/test-link`
      : `https://app.employeepulse.app/rhythm-engine/${inviteStage}/link/test-link`;
    const dueDate = pulseInviteDueDateForScope(org.settings, timepointPhase, duringSessionId);
    try {
      await sendPulseInviteEmail(targetEmail, displayName || 'Test recipient', testLink, org.name, {
        audience,
        subjectTemplate: subject,
        bodyTemplateHtml: bodyHtml,
        dueDate,
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

  router.put('/organizations/:id/pulse-link-invites/due-date', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint);
    const duringSessionId = parsePulseInviteDuringSessionId(req.query?.duringSessionId);
    const duringSessionError = validatePulseInviteDuringSession(timepointPhase, duringSessionId);
    if (duringSessionError) return res.status(400).json({ error: duringSessionError });
    const dueDateValue = req.body?.dueDate;
    const dueDate = normalizeDateOnly(dueDateValue);
    if (dueDateValue != null && dueDateValue !== '' && !dueDate) {
      return res.status(400).json({ error: 'dueDate must be YYYY-MM-DD or empty' });
    }
    const scopeKey = pulseInviteScopeKey(timepointPhase, duringSessionId);
    if (!scopeKey) {
      return res.status(400).json({ error: 'Could not resolve due date scope' });
    }
    const dueDates = pulseInviteDueDatesFromSettings(org.settings);
    if (dueDate) dueDates[scopeKey] = dueDate;
    else delete dueDates[scopeKey];
    const updated = await Organization.updateOrganizationSettings(org.id, {
      pulseInviteDueDates: dueDates,
    });
    if (!updated) return res.status(404).json({ error: 'Organization not found' });
    return res.json({
      dueDate: pulseInviteDueDateForScope(updated.settings, timepointPhase, duringSessionId),
    });
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
    const rawGroupNames = Array.isArray(req.body?.groupNames) ? req.body.groupNames : [];
    const normalizedGroupNames = groupLabels.map((_, index) => {
      const level = Array.isArray(rawGroupNames[index]) ? rawGroupNames[index] : [];
      return level.map((n) => String(n ?? '').trim()).filter(Boolean);
    });
    const datasetToken = randomUUID().replace(/-/g, '').slice(0, 12);

    const recipients = buildTestRecipients({
      managerCount,
      staffCount,
      groupLabels,
      groupNames: normalizedGroupNames,
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
    const sessionsByRole = new Map();
    let completedResponses = 0;
    const completionErrors = [];
    for (let index = 0; index < upsertResult.upsertedRows.length; index += 1) {
      const inviteRow = upsertResult.upsertedRows[index]?.invite;
      if (!inviteRow) continue;
      try {
        const role = inviteRow.survey_role === 'manager' ? 'manager' : 'staff';
        const session = await resolvePulseImportSessionForScope({
          organizationId: req.params.id,
          role,
          stage,
          duringSessionId,
          sessionCache: sessionsByRole,
        });
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

  router.post(
    '/organizations/:id/pulse-link-invites/test-data/import-docx',
    testDataDocUpload.single('file'),
    async (req, res) => {
      const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
      if (!org) return res.status(404).json({ error: 'Organization not found' });
      if (!req.file?.buffer) return res.status(400).json({ error: 'Attach a DOCX file first.' });

      const fileName = String(req.file?.originalname || '').toLowerCase();
      const mimeType = String(req.file?.mimetype || '').toLowerCase();
      const validMime = mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      if (!fileName.endsWith('.docx') && !validMime) {
        return res.status(400).json({ error: 'Only .docx files are supported for test-data import.' });
      }

      const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint);
      const duringSessionId = parsePulseInviteDuringSessionId(req.query?.duringSessionId);
      const dryRun = parseQueryBool(req.query?.dryRun, false);
      const duringSessionError = validatePulseInviteDuringSession(timepointPhase, duringSessionId);
      if (duringSessionError) return res.status(400).json({ error: duringSessionError });

      let parsed;
      try {
        parsed = await parseHumanTestDocx(req.file.buffer);
      } catch (error) {
        return res.status(400).json({
          error: String(error?.message || 'Could not parse DOCX file.').slice(0, 300),
        });
      }

      const allRows = [...parsed.employeeRows, ...parsed.managerRows];
      const stage = internalTimepointToPulseStage(timepointPhase);
      const existingInvites = await PulseLinkInvite.listInviteRowsForOrg(req.params.id, {
        timepointPhase,
        duringSessionId,
      });
      const inviteLookup = buildDocImportInviteLookup(existingInvites);
      const sessionsByRole = new Map();

      const matchedRows = [];
      const unmatchedRows = [];
      for (const row of allRows) {
        const invite = consumeInviteMatch(inviteLookup, row.role, row.name);
        if (!invite) {
          unmatchedRows.push({ name: row.name, role: row.role });
          continue;
        }
        matchedRows.push({ row, invite });
      }
      if (dryRun) {
        return res.json({
          ok: true,
          dryRun: true,
          canImport: unmatchedRows.length === 0,
          parsedEmployees: parsed.employeeRows.length,
          parsedManagers: parsed.managerRows.length,
          parsedTotal: parsed.totalRows,
          matchedRows: matchedRows.length,
          unmatchedCount: unmatchedRows.length,
          unmatchedRows: unmatchedRows.slice(0, 50),
          timepoint: stage,
        });
      }
      if (unmatchedRows.length > 0) {
        return res.status(400).json({
          error: `${unmatchedRows.length} recipient(s) in the DOCX were not found in this client/timepoint.`,
          unmatchedCount: unmatchedRows.length,
          unmatchedRows: unmatchedRows.slice(0, 50),
        });
      }

      let completedResponses = 0;
      const completionErrors = [];
      const matchedInviteIds = matchedRows.map(({ invite }) => invite.id).filter(Boolean);

      for (const { row, invite } of matchedRows) {
        try {
          const session = await resolvePulseImportSessionForScope({
            organizationId: req.params.id,
            role: row.role,
            stage,
            duringSessionId,
            sessionCache: sessionsByRole,
          });
          await PulseLinkResponse.ensureResponseRow(invite.id, session.id, stage);
          const completed = await PulseLinkResponse.completeResponse({
            inviteId: invite.id,
            sessionId: session.id,
            stage,
            step1: { answers: row.answers },
            step2: {},
            step3: {},
            step4: {},
            contributionStyle: null,
          });
          if (completed) completedResponses += 1;
        } catch (error) {
          completionErrors.push({
            name: row.name,
            role: row.role,
            inviteId: invite.id,
            error: String(error?.message || 'response_completion_failed').slice(0, 200),
          });
        }
      }

      const verifiedCompletedRows = await PulseLinkResponse.countCompletedForInviteIds(matchedInviteIds);

      return res.json({
        ok: true,
        parsedEmployees: parsed.employeeRows.length,
        parsedManagers: parsed.managerRows.length,
        parsedTotal: parsed.totalRows,
        matchedRows: matchedRows.length,
        completedResponses,
        unmatchedCount: 0,
        unmatchedRows: [],
        completionErrorCount: completionErrors.length,
        completionErrors: completionErrors.slice(0, 20),
        verifiedCompletedRows,
        verifiedPendingRows: Math.max(0, matchedRows.length - verifiedCompletedRows),
        timepoint: stage,
      });
    }
  );

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
    const templateTimepointKey = normalizePulseInviteTemplateTimepointKey(timepointPhase);
    const template = pulseInviteTemplateFromSettings(
      org.settings,
      audience,
      org.name,
      platformOrg?.settings,
      templateTimepointKey
    );
    const dueDate = pulseInviteDueDateForScope(org.settings, timepointPhase, duringSessionId);
    try {
      await sendPulseInviteEmail(invite.email, invite.display_name, linkUrl, org.name, {
        audience,
        subjectTemplate: template.subject,
        bodyTemplateHtml: template.bodyHtml,
        dueDate,
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

  router.delete('/organizations/:id/pulse-link-invites', async (req, res) => {
    const orgId = req.params.id;
    const org = await assertClientOrganizationPlatformForUser(orgId, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const timepointPhase = parsePulseInviteTimepoint(req.query?.timepoint);
    const duringSessionId = parsePulseInviteDuringSessionId(req.query?.duringSessionId);
    const duringSessionError = validatePulseInviteDuringSession(timepointPhase, duringSessionId);
    if (duringSessionError) return res.status(400).json({ error: duringSessionError });

    const inviteRows = await PulseLinkInvite.listInvitesForOrg(orgId, {
      timepointPhase,
      duringSessionId,
    });
    const completedInviteIds = new Set(
      inviteRows
        .filter((row) => row?.survey_completed_at)
        .map((row) => row.id)
    );
    const deletableRows = inviteRows.filter((row) => !completedInviteIds.has(row.id));

    let deletedCount = 0;
    for (const invite of deletableRows) {
      const ok = await PulseLinkInvite.deleteInviteInOrg(invite.id, orgId, {
        timepointPhase,
        duringSessionId,
      });
      if (ok) deletedCount += 1;
    }

    return res.json({
      ok: true,
      total: inviteRows.length,
      deletedCount,
      skippedCompletedCount: completedInviteIds.size,
    });
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
