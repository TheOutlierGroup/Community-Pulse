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
     ORDER BY lower(pli.email)`,
    [organizationId, timepointPhase]
  );
  return rows;
}

export async function listInviteRowsForOrg(organizationId, options = {}) {
  const timepointPhase = normalizeInviteTimepointPhase(options?.timepointPhase);
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
     ORDER BY lower(pli.email)`,
    [organizationId, timepointPhase]
  );
  return rows;
}

export async function getInviteInOrg(inviteId, organizationId, options = {}) {
  const timepointPhase = options?.timepointPhase;
  const normalizedPhase =
    timepointPhase == null ? null : normalizeInviteTimepointPhase(timepointPhase);
  const { rows } =
    normalizedPhase == null
      ? await query(`SELECT * FROM pulse_link_invites WHERE id = $1 AND organization_id = $2`, [inviteId, organizationId])
      : await query(
          `SELECT * FROM pulse_link_invites
           WHERE id = $1
             AND organization_id = $2
             AND timepoint_phase = $3`,
          [inviteId, organizationId, normalizedPhase]
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

export async function findByTokenHash(tokenHash) {
  const { rows } = await query(`SELECT * FROM pulse_link_invites WHERE token_hash = $1`, [tokenHash]);
  return rows[0] || null;
}

export async function upsertInviteRow({
  organizationId,
  timepointPhase = 'pre',
  displayName,
  email,
  surveyRole = 'staff',
  managerInviteId = null,
  groupLevelValues = [],
}) {
  const em = normalizeEmail(email);
  if (!em) return { row: null, error: 'invalid_email' };
  const role = surveyRole === 'manager' ? 'manager' : 'staff';
  const phase = normalizeInviteTimepointPhase(timepointPhase);
  const name = String(displayName || '').trim();
  const managerId = role === 'manager' ? null : managerInviteId || null;
  const normalizedGroupLevelValues = normalizeGroupLevelValues(groupLevelValues);
  const { rows } = await query(
    `INSERT INTO pulse_link_invites (
       organization_id,
       timepoint_phase,
       display_name,
       email,
       survey_role,
       manager_invite_id,
       group_level_values
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (organization_id, timepoint_phase, email) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       survey_role = EXCLUDED.survey_role,
       manager_invite_id = EXCLUDED.manager_invite_id,
       group_level_values = EXCLUDED.group_level_values,
       updated_at = NOW()
     RETURNING *`,
    [organizationId, phase, name, em, role, managerId, JSON.stringify(normalizedGroupLevelValues)]
  );
  return { row: rows[0], error: null };
}

export async function updateManagerInviteId(inviteId, organizationId, managerInviteId, options = {}) {
  const timepointPhase = options?.timepointPhase;
  const normalizedPhase =
    timepointPhase == null ? null : normalizeInviteTimepointPhase(timepointPhase);
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
           RETURNING *`,
          [inviteId, organizationId, managerInviteId || null, normalizedPhase]
        );
  return rows[0] || null;
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
  const { rowCount } =
    normalizedPhase == null
      ? await query(`DELETE FROM pulse_link_invites WHERE id = $1 AND organization_id = $2`, [inviteId, organizationId])
      : await query(
          `DELETE FROM pulse_link_invites
           WHERE id = $1
             AND organization_id = $2
             AND timepoint_phase = $3`,
          [inviteId, organizationId, normalizedPhase]
        );
  return rowCount > 0;
}

export async function rotateTokenAndMarkSent(inviteId, organizationId) {
  await PulseLinkResponse.deleteIncompleteForInvite(inviteId);
  const raw = randomUUID();
  const tokenHash = hashInviteToken(raw);
  const { rows } = await query(
    `UPDATE pulse_link_invites SET
       token_hash = $3,
       last_invited_at = NOW(),
       updated_at = NOW()
     WHERE id = $1 AND organization_id = $2
     RETURNING *`,
    [inviteId, organizationId, tokenHash]
  );
  if (!rows[0]) return null;
  return { row: rows[0], rawToken: raw };
}
