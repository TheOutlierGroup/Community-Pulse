import { randomUUID } from 'crypto';
import { query } from '../config/database.js';
import { hashInviteToken } from '../security/inviteToken.js';
import * as PulseLinkResponse from './PulseLinkResponse.js';
import {
  internalTimepointToPulseStage,
  normalizePulseStage,
  pulseStageToInternalTimepoint,
} from '../services/pulseStage.js';

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function normalizeGroupLevelValues(values) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, 5).map((value) => {
    const normalized = String(value ?? '').trim();
    return normalized || null;
  });
}

export function normalizeInviteTimepointPhase(raw) {
  return pulseStageToInternalTimepoint(normalizePulseStage(raw));
}

function inviteInstanceKeyForScope(timepointPhase, options = {}) {
  // timepointPhase here is always the already-internally-normalized value
  // from normalizeInviteTimepointPhase ('pre' | 'during' | 'completed'), not
  // the external canonical stage name ('pre' | 'mid' | 'post') — compare
  // against 'during', not 'mid'.
  if (timepointPhase === 'pre') return 'pre';
  if (timepointPhase === 'completed') return 'post';
  if (timepointPhase !== 'during') return null;
  const duringSessionId = String(options?.duringSessionId || '').trim();
  if (!duringSessionId) return null;
  return `session:${duringSessionId}`;
}

export function publicInviteRow(row) {
  if (!row) return null;
  const completedAt = row.survey_completed_at ?? null;
  const started = Boolean(row.survey_started);
  const openedOnly = Boolean(row.survey_opened_only);
  const sent = Boolean(row.last_invited_at);

  let surveyStatus = 'not_sent';
  if (completedAt) surveyStatus = 'completed';
  else if (started) surveyStatus = 'started';
  else if (openedOnly) surveyStatus = 'opened';
  else if (sent) surveyStatus = 'sent';

  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    timepointPhase: internalTimepointToPulseStage(row.timepoint_phase),
    surveyRole: row.survey_role || 'staff',
    managerInviteId: row.manager_invite_id || null,
    managerName: row.manager_display_name || null,
    managerEmail: row.manager_email || null,
    groupValues: normalizeGroupLevelValues(row.group_level_values),
    lastInvitedAt: row.last_invited_at,
    createdAt: row.created_at,
    surveyStatus,
    surveyCompletedAt: completedAt,
  };
}

export async function listInvitesForOrg(organizationId, options = {}) {
  const timepointPhase = normalizeInviteTimepointPhase(options?.timepointPhase);
  const timepointInstanceKey = inviteInstanceKeyForScope(timepointPhase, options);
  const { rows } = await query(
    `SELECT pli.id,
            pli.display_name,
            pli.email,
            pli.timepoint_phase,
            pli.survey_role,
            pli.manager_invite_id,
            pli.group_level_values,
            mgr.display_name AS manager_display_name,
            mgr.email AS manager_email,
            pli.last_invited_at,
            pli.created_at,
            (SELECT MAX(plr.completed_at)
             FROM pulse_link_responses plr
             WHERE plr.invite_id = pli.id
               AND plr.completed_at IS NOT NULL) AS survey_completed_at,
            (SELECT EXISTS (
               SELECT 1
               FROM pulse_link_responses plr
               WHERE plr.invite_id = pli.id
                 AND plr.completed_at IS NULL
                 AND (
                   plr.survey_started_at IS NOT NULL
                   OR plr.current_step > 1
                   OR plr.step1_data <> '{}'::jsonb
                   OR plr.step2_data <> '{}'::jsonb
                   OR plr.step3_data <> '{}'::jsonb
                   OR plr.step4_data <> '{}'::jsonb
                 )
             )) AS survey_started,
            (SELECT EXISTS (
               SELECT 1
               FROM pulse_link_responses plr
               WHERE plr.invite_id = pli.id
                 AND plr.completed_at IS NULL
                 AND plr.link_opened_at IS NOT NULL
                 AND plr.survey_started_at IS NULL
                 AND plr.current_step <= 1
                 AND plr.step1_data = '{}'::jsonb
                 AND plr.step2_data = '{}'::jsonb
                 AND plr.step3_data = '{}'::jsonb
                 AND plr.step4_data = '{}'::jsonb
             )) AS survey_opened_only
     FROM pulse_link_invites pli
     LEFT JOIN pulse_link_invites mgr
       ON mgr.id = pli.manager_invite_id
      AND mgr.organization_id = pli.organization_id
     WHERE pli.organization_id = $1
       AND pli.timepoint_phase = $2
       AND ($3::text IS NULL OR pli.timepoint_instance_key = $3)
     ORDER BY lower(pli.email)`,
    [organizationId, timepointPhase, timepointInstanceKey]
  );
  return rows;
}

export async function listInviteRowsForOrg(organizationId, options = {}) {
  const timepointPhase = normalizeInviteTimepointPhase(options?.timepointPhase);
  const timepointInstanceKey = inviteInstanceKeyForScope(timepointPhase, options);
  const { rows } = await query(
    `SELECT pli.id,
            pli.organization_id,
            pli.display_name,
            pli.email,
            pli.timepoint_phase,
            pli.survey_role,
            pli.manager_invite_id,
            pli.group_level_values,
            pli.last_invited_at,
            pli.created_at,
            pli.updated_at,
            mgr.display_name AS manager_display_name,
            mgr.email AS manager_email
     FROM pulse_link_invites pli
     LEFT JOIN pulse_link_invites mgr
       ON mgr.id = pli.manager_invite_id
      AND mgr.organization_id = pli.organization_id
     WHERE pli.organization_id = $1
       AND pli.timepoint_phase = $2
       AND ($3::text IS NULL OR pli.timepoint_instance_key = $3)
     ORDER BY lower(pli.email)`,
    [organizationId, timepointPhase, timepointInstanceKey]
  );
  return rows;
}

export async function listStaffInviteResponseRowsForOrg(organizationId, options = {}) {
  const timepointPhase = normalizeInviteTimepointPhase(options?.timepointPhase);
  const timepointInstanceKey = inviteInstanceKeyForScope(timepointPhase, options);
  const { rows } = await query(
    `SELECT pli.id AS invite_id,
            pli.email,
            pli.display_name,
            pli.timepoint_phase,
            plr.id AS response_id,
            plr.completed_at,
            plr.step1_data,
            plr.step2_data,
            plr.step3_data,
            plr.step4_data
     FROM pulse_link_invites pli
     JOIN pulse_link_responses plr ON plr.invite_id = pli.id
     WHERE pli.organization_id = $1
       AND pli.timepoint_phase = $2
       AND ($3::text IS NULL OR pli.timepoint_instance_key = $3)
       AND pli.survey_role = 'staff'
     ORDER BY pli.id ASC, plr.updated_at DESC`,
    [organizationId, timepointPhase, timepointInstanceKey]
  );
  return rows;
}

export async function getInviteInOrg(inviteId, organizationId, options = {}) {
  const timepointPhase = options?.timepointPhase;
  const normalizedPhase =
    timepointPhase == null ? null : normalizeInviteTimepointPhase(timepointPhase);
  const timepointInstanceKey =
    normalizedPhase == null ? null : inviteInstanceKeyForScope(normalizedPhase, options);
  const { rows } =
    normalizedPhase == null
      ? await query(`SELECT * FROM pulse_link_invites WHERE id = $1 AND organization_id = $2`, [inviteId, organizationId])
      : await query(
          `SELECT * FROM pulse_link_invites
           WHERE id = $1
             AND organization_id = $2
             AND timepoint_phase = $3
             AND ($4::text IS NULL OR timepoint_instance_key = $4)`,
          [inviteId, organizationId, normalizedPhase, timepointInstanceKey]
        );
  return rows[0] || null;
}

/** True if this invite has at least one completed pulse_link_responses row. */
export async function inviteHasCompletedSurvey(inviteId) {
  const { rows } = await query(
    `SELECT 1 FROM pulse_link_responses
     WHERE invite_id = $1 AND completed_at IS NOT NULL
     LIMIT 1`,
    [inviteId]
  );
  return Boolean(rows[0]);
}

// PT-02: how long a freshly-sent survey link stays redeemable. Long
// enough to outlast any realistic wave (a link that dies mid-survey is a
// support ticket and a lost response), short enough that a forwarded
// email is not a permanent credential. Re-sending mints a new token and
// restarts the window, so this is a ceiling, not a deadline.
const DEFAULT_LINK_TOKEN_TTL_DAYS = 90;

export function pulseLinkTokenTtlDays() {
  const raw = Number.parseInt(String(process.env.PULSE_LINK_TOKEN_TTL_DAYS || ''), 10);
  if (!Number.isInteger(raw) || raw <= 0) return DEFAULT_LINK_TOKEN_TTL_DAYS;
  // Bounded so a typo can't reinstate an effectively immortal link.
  return Math.min(raw, 365);
}

/**
 * PT-02: fail closed on expiry.
 *
 * A token with no expires_at is refused rather than treated as
 * non-expiring. Migration 081 backfills every row that holds a token and
 * rotateTokenAndMarkSent always sets one, so this cannot reject a
 * legitimate link today — the point is that a future code path which
 * writes a token_hash without an expiry produces a dead link instead of
 * silently minting another permanent one.
 */
export async function findByTokenHash(tokenHash) {
  const { rows } = await query(
    `SELECT * FROM pulse_link_invites
     WHERE token_hash = $1
       AND expires_at IS NOT NULL
       AND expires_at > NOW()`,
    [tokenHash]
  );
  return rows[0] || null;
}

export async function upsertInviteRow({
  organizationId,
  timepointPhase = 'pre',
  duringSessionId = null,
  displayName,
  email,
  surveyRole = 'staff',
  managerInviteId = null,
  groupLevelValues = [],
  respondentCountryCode = null,
  privacyNoticeVersion = null,
}) {
  const em = normalizeEmail(email);
  if (!em) return { row: null, error: 'invalid_email' };
  const role = surveyRole === 'manager' ? 'manager' : 'staff';
  const phase = normalizeInviteTimepointPhase(timepointPhase);
  const timepointInstanceKey = inviteInstanceKeyForScope(phase, { duringSessionId });
  if (phase === 'during' && !timepointInstanceKey) return { row: null, error: 'missing_during_session' };
  const name = String(displayName || '').trim();
  const managerId = role === 'manager' ? null : managerInviteId || null;
  const normalizedGroupLevelValues = normalizeGroupLevelValues(groupLevelValues);
  const { rows } = await query(
    `INSERT INTO pulse_link_invites (
       organization_id,
       timepoint_phase,
       timepoint_instance_key,
       display_name,
       email,
       survey_role,
       manager_invite_id,
       group_level_values,
       respondent_country_code,
       privacy_notice_version
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
     ON CONFLICT (organization_id, timepoint_phase, timepoint_instance_key, email) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       survey_role = EXCLUDED.survey_role,
       manager_invite_id = EXCLUDED.manager_invite_id,
       group_level_values = EXCLUDED.group_level_values,
       respondent_country_code = COALESCE(EXCLUDED.respondent_country_code, pulse_link_invites.respondent_country_code),
       privacy_notice_version = COALESCE(EXCLUDED.privacy_notice_version, pulse_link_invites.privacy_notice_version),
       updated_at = NOW()
     RETURNING *`,
    [
      organizationId,
      phase,
      timepointInstanceKey || (phase === 'pre' ? 'pre' : 'post'),
      name,
      em,
      role,
      managerId,
      JSON.stringify(normalizedGroupLevelValues),
      respondentCountryCode ? String(respondentCountryCode).trim().toUpperCase().slice(0, 8) : null,
      privacyNoticeVersion ? String(privacyNoticeVersion).trim().slice(0, 64) : null,
    ]
  );
  return { row: rows[0], error: null };
}

export async function updateManagerInviteId(inviteId, organizationId, managerInviteId, options = {}) {
  const timepointPhase = options?.timepointPhase;
  const normalizedPhase =
    timepointPhase == null ? null : normalizeInviteTimepointPhase(timepointPhase);
  const timepointInstanceKey =
    normalizedPhase == null ? null : inviteInstanceKeyForScope(normalizedPhase, options);
  const { rows } =
    normalizedPhase == null
      ? await query(
          `UPDATE pulse_link_invites
           SET manager_invite_id = $3,
               updated_at = NOW()
           WHERE id = $1 AND organization_id = $2
           RETURNING *`,
          [inviteId, organizationId, managerInviteId || null]
        )
      : await query(
          `UPDATE pulse_link_invites
           SET manager_invite_id = $3,
               updated_at = NOW()
           WHERE id = $1
             AND organization_id = $2
             AND timepoint_phase = $4
             AND ($5::text IS NULL OR timepoint_instance_key = $5)
           RETURNING *`,
          [inviteId, organizationId, managerInviteId || null, normalizedPhase, timepointInstanceKey]
        );
  return rows[0] || null;
}

export async function promoteInvitesToManagerInOrg(inviteIds, organizationId, options = {}) {
  const ids = Array.isArray(inviteIds)
    ? inviteIds
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    : [];
  if (ids.length === 0) return [];
  const timepointPhase = normalizeInviteTimepointPhase(options?.timepointPhase);
  const timepointInstanceKey = inviteInstanceKeyForScope(timepointPhase, options);
  const { rows } = await query(
    `UPDATE pulse_link_invites
     SET survey_role = 'manager',
         manager_invite_id = NULL,
         updated_at = NOW()
     WHERE organization_id = $1
       AND timepoint_phase = $2
       AND ($4::text IS NULL OR timepoint_instance_key = $4)
       AND id = ANY($3::uuid[])
     RETURNING id, email, display_name, timepoint_phase`,
    [organizationId, timepointPhase, ids, timepointInstanceKey]
  );
  return rows;
}

/**
 * Clears incomplete survey rows for this invite, rotates token (prior links stop working),
 * and sets last_invited_at. Returns raw token for the email link.
 */
export async function countSentInvitesForOrg(organizationId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM pulse_link_invites
     WHERE organization_id = $1 AND last_invited_at IS NOT NULL`,
    [organizationId]
  );
  return rows[0]?.n ?? 0;
}

/** Count of recipients who have been sent a link at least once, by survey role. */
export async function countSentInvitesBySurveyRole(organizationId) {
  const { rows } = await query(
    `SELECT survey_role, COUNT(*)::int AS n
     FROM pulse_link_invites
     WHERE organization_id = $1 AND last_invited_at IS NOT NULL
     GROUP BY survey_role`,
    [organizationId]
  );
  const out = { staff: 0, manager: 0 };
  for (const r of rows) {
    if (r.survey_role === 'manager') out.manager = r.n;
    else out.staff = r.n;
  }
  return out;
}

export async function deleteInviteInOrg(inviteId, organizationId, options = {}) {
  const timepointPhase = options?.timepointPhase;
  const normalizedPhase =
    timepointPhase == null ? null : normalizeInviteTimepointPhase(timepointPhase);
  const timepointInstanceKey =
    normalizedPhase == null ? null : inviteInstanceKeyForScope(normalizedPhase, options);
  const { rowCount } =
    normalizedPhase == null
      ? await query(`DELETE FROM pulse_link_invites WHERE id = $1 AND organization_id = $2`, [inviteId, organizationId])
      : await query(
          `DELETE FROM pulse_link_invites
           WHERE id = $1
             AND organization_id = $2
             AND timepoint_phase = $3
             AND ($4::text IS NULL OR timepoint_instance_key = $4)`,
          [inviteId, organizationId, normalizedPhase, timepointInstanceKey]
        );
  return rowCount > 0;
}

export async function rotateTokenAndMarkSent(inviteId, organizationId) {
  await PulseLinkResponse.deleteIncompleteForInvite(inviteId);
  const raw = randomUUID();
  const tokenHash = hashInviteToken(raw);
  // PT-02: the single point where a survey link token is issued, so the
  // single point that needs to stamp its expiry. Re-sending restarts the
  // window, which is what makes a bounded TTL workable operationally.
  const { rows } = await query(
    `UPDATE pulse_link_invites SET
       token_hash = $3,
       last_invited_at = NOW(),
       expires_at = NOW() + ($4::int * INTERVAL '1 day'),
       updated_at = NOW()
     WHERE id = $1 AND organization_id = $2
     RETURNING *`,
    [inviteId, organizationId, tokenHash, pulseLinkTokenTtlDays()]
  );
  if (!rows[0]) return null;
  return { row: rows[0], rawToken: raw };
}

export async function updateInvitePrivacyMetadata(
  inviteId,
  organizationId,
  { respondentCountryCode = null, privacyNoticeVersion = null } = {}
) {
  const country = respondentCountryCode ? String(respondentCountryCode).trim().toUpperCase().slice(0, 8) : null;
  const noticeVersion = privacyNoticeVersion ? String(privacyNoticeVersion).trim().slice(0, 64) : null;
  const { rows } = await query(
    `UPDATE pulse_link_invites
     SET respondent_country_code = COALESCE($3, respondent_country_code),
         privacy_notice_version = COALESCE($4, privacy_notice_version),
         updated_at = NOW()
     WHERE id = $1 AND organization_id = $2
     RETURNING *`,
    [inviteId, organizationId, country, noticeVersion]
  );
  return rows[0] || null;
}
