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
import * as PlatformUserClientAssignment from '../../models/PlatformUserClientAssignment.js';
import {
  isResendConfigured,
  sendPlatformWelcomeEmail,
  sendPulseInviteEmail,
} from '../../services/email.js';
import { classifyQuadrant, DIMENSIONS, READINESS_THRESHOLD, scoreResponseFromSteps } from '../../services/pulseEngine.js';
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
import { createPulseHandoffToken } from '../../security/pulseHandoffToken.js';
import {
  CLIENT_SERVICE_PULSE,
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
    audience
  );
}

function quadrantLabel(adoption, sponsorship) {
  return classifyQuadrant(adoption, sponsorship).label;
}

function scoreDelta(current, previous) {
  if (current == null || previous == null) return null;
  return round1(current - previous);
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
  const v = String(value || '')
    .trim()
    .toLowerCase();
  if (v === 'pre' || v === 'during' || v === 'completed') return v;
  return null;
}

function createDuringPulseCheckpointName(now = new Date()) {
  return `During checkpoint · ${now.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })}`;
}

async function listMergedResponsesForSession(sessionId) {
  const { rows } = await listSessionResponses(sessionId);
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
const CLIENT_STATUSES = new Set(['lead', 'active', 'inactive', 'closed']);

function parseMultipartBool(v) {
  if (v === true || v === 'true' || v === '1') return true;
  if (v === false || v === 'false' || v === '0') return false;
  return false;
}

function normalizeClientStatus(value) {
  const status = String(value || '')
    .trim()
    .toLowerCase();
  if (!CLIENT_STATUSES.has(status)) return null;
  return status;
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
        return res.status(400).json({ error: 'clientStatus must be one of: lead, active, inactive, closed' });
      }
    }
    let settingsPatch = settings;
    if (settings !== undefined) {
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return res.status(400).json({ error: 'settings must be an object' });
      }
      settingsPatch = { ...settings };
      if (Object.prototype.hasOwnProperty.call(settingsPatch, 'services')) {
        const normalized = normalizeServiceIds(settingsPatch.services);
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

  router.post('/organizations/:id/pulse-timepoints/during', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    if (!organizationHasService(org.settings, CLIENT_SERVICE_PULSE)) {
      return res.status(403).json({ error: 'Pulse is not enabled for this client' });
    }

    const name = createDuringPulseCheckpointName(new Date());
    const [staffSession, managerSession] = await Promise.all([
      PulseSession.createSession(org.id, name, 'active', 'staff', 'during_project'),
      PulseSession.createSession(org.id, name, 'active', 'manager', 'during_project'),
    ]);

    res.status(201).json({
      checkpointDate: pulseSessionDateKey(staffSession),
      sessions: [staffSession, managerSession].map(publicPulseSessionRow),
    });
  });

  router.get('/organizations/:id/pulse-dashboard', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const [sessions, activeUsersByRole, pulseLinkByRole, inviteRows] = await Promise.all([
      PulseSession.listSessionsForOrg(req.params.id),
      User.countActiveUsersByRoleForOrg(req.params.id),
      PulseLinkInvite.countSentInvitesBySurveyRole(req.params.id),
      PulseLinkInvite.listInviteRowsForOrg(req.params.id),
    ]);
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

    const requestedTimepoint = parsePulseDashboardTimepoint(req.query?.timepoint);
    const requestedDuringDate = String(req.query?.duringDate || '').trim();
    const timepointFiltered = requestedTimepoint
      ? sessions.filter((s) => pulseSessionTimepointKind(s) === requestedTimepoint)
      : sessions;
    const dateFiltered = requestedTimepoint === 'during' && requestedDuringDate
      ? timepointFiltered.filter((s) => pulseSessionDateKey(s) === requestedDuringDate)
      : timepointFiltered;
    const candidateSessions = dateFiltered.length > 0 ? dateFiltered : timepointFiltered;

    const activeSessions = candidateSessions.filter((s) => s.status === 'active');
    const currentSession =
      candidateSessions.find((s) => s.status === 'active' && s.audience === 'staff') ||
      candidateSessions.find((s) => s.status === 'active' && s.audience === 'manager') ||
      candidateSessions[0] ||
      null;

    const sessionsForCurrentRows =
      activeSessions.length > 0 ? activeSessions : currentSession ? [currentSession] : [];
    const currentRows =
      sessionsForCurrentRows.length > 0
        ? (
            await Promise.all(sessionsForCurrentRows.map((s) => listMergedResponsesForSession(s.id)))
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

    const sessionsForTrend = candidateSessions.length > 0 ? candidateSessions : sessions;
    const allSessionRows = sessionsForTrend.length > 0
      ? (await Promise.all(sessionsForTrend.map((s) => listMergedResponsesForSession(s.id)))).flat()
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
      return res.status(403).json({ error: 'Pulse is not enabled for this client' });
    }

    const pulseBaseUrl = resolvePulseAppBaseUrl();
    if (!pulseBaseUrl) {
      return res.status(500).json({ error: 'Set PULSE_APP_URL or APP_URL to issue Pulse links' });
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
    const rows = await PulseLinkInvite.listInvitesForOrg(req.params.id);
    res.json({ invites: rows.map(PulseLinkInvite.publicInviteRow) });
  });

  router.post('/organizations/:id/pulse-link-invites/import', async (req, res) => {
    const org = await assertClientOrganizationPlatformForUser(req.params.id, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const recipients = req.body?.recipients;
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'recipients must be a non-empty array' });
    }
    if (recipients.length > 2000) {
      return res.status(400).json({ error: 'Too many rows at once (max 2000)' });
    }
    const existingInvites = await PulseLinkInvite.listInviteRowsForOrg(req.params.id);
    const invitesById = new Map(existingInvites.map((row) => [row.id, row]));
    const normalizedRows = normalizeInviteImportRecipients(recipients);
    const prevalidation = validateInviteImportRows(normalizedRows, invitesById);
    const errors = [...prevalidation.errors];
    const invalidIndices = new Set(prevalidation.invalidIndices);
    const managerRefToRow = prevalidation.managerRefToRow;

    const upsertedRows = [];
    for (const row of normalizedRows) {
      if (invalidIndices.has(row.index)) continue;
      const { row: upsertedRow, error } = await PulseLinkInvite.upsertInviteRow({
        organizationId: req.params.id,
        displayName: row.displayName,
        email: row.email,
        surveyRole: row.surveyRole,
        managerInviteId: null,
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
        await PulseLinkInvite.updateManagerInviteId(invite.id, req.params.id, null);
        continue;
      }
      let resolvedManagerId = null;
      if (source.managerInviteId) {
        resolvedManagerId = source.managerInviteId;
      } else if (source.managerRef) {
        resolvedManagerId = managerRefToInviteId.get(source.managerRef) || null;
      }
      if (!resolvedManagerId) {
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
        || (await PulseLinkInvite.getInviteInOrg(resolvedManagerId, req.params.id));
      if (!resolvedManagerRow || resolvedManagerRow.survey_role !== 'manager') {
        errors.push({
          index: source.index,
          email: source.email,
          error: 'invalid_manager_invite',
        });
        continue;
      }
      const updated = await PulseLinkInvite.updateManagerInviteId(invite.id, req.params.id, resolvedManagerId);
      if (!updated) {
        errors.push({
          index: source.index,
          email: source.email,
          error: 'manager_assignment_failed',
        });
      }
    }
    res.json({
      upserted: upsertedRows.length,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
    });
  });

  router.post('/organizations/:id/pulse-link-invites/:inviteId/send', async (req, res) => {
    const orgId = req.params.id;
    const org = await assertClientOrganizationPlatformForUser(orgId, req.user);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const invite = await PulseLinkInvite.getInviteInOrg(req.params.inviteId, orgId);
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
    const linkUrl = `${baseUrl}/pulse/link/${rotated.rawToken}`;
    try {
      await sendPulseInviteEmail(invite.email, invite.display_name, linkUrl, org.name);
    } catch (e) {
      console.error('Pulse link invite send failed:', e);
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
    const invite = await PulseLinkInvite.getInviteInOrg(req.params.inviteId, orgId);
    if (!invite) return res.status(404).json({ error: 'Invite not found' });
    if (await PulseLinkInvite.inviteHasCompletedSurvey(invite.id)) {
      return res.status(409).json({
        error: 'Survey already completed',
        details: 'This recipient has finished the questionnaire. They cannot be removed from the list.',
      });
    }
    const ok = await PulseLinkInvite.deleteInviteInOrg(invite.id, orgId);
    if (!ok) return res.status(404).json({ error: 'Invite not found' });
    res.status(204).end();
  });
}
