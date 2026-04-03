import { randomUUID } from 'crypto';
import { query } from '../config/database.js';
import { hashInviteToken } from '../security/inviteToken.js';

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

export function publicInviteRow(row) {
  if (!row) return null;
  const completedAt = row.survey_completed_at ?? null;
  const inProgress = Boolean(row.survey_in_progress);
  const hasOpened = Boolean(row.survey_has_opened);
  const sent = Boolean(row.last_invited_at);

  let surveyStatus = 'not_sent';
  if (completedAt) surveyStatus = 'completed';
  else if (inProgress) surveyStatus = 'in_progress';
  else if (hasOpened) surveyStatus = 'opened';
  else if (sent) surveyStatus = 'sent';

  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    surveyRole: row.survey_role || 'staff',
    lastInvitedAt: row.last_invited_at,
    createdAt: row.created_at,
    surveyStatus,
    surveyCompletedAt: completedAt,
  };
}

export async function listInvitesForOrg(organizationId) {
  const { rows } = await query(
    `SELECT pli.id,
            pli.display_name,
            pli.email,
            pli.survey_role,
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
                   plr.current_step > 1
                   OR plr.step1_data <> '{}'::jsonb
                   OR plr.step2_data <> '{}'::jsonb
                   OR plr.step3_data <> '{}'::jsonb
                   OR plr.step4_data <> '{}'::jsonb
                 )
             )) AS survey_in_progress,
            (SELECT EXISTS (
               SELECT 1
               FROM pulse_link_responses plr
               WHERE plr.invite_id = pli.id
                 AND plr.completed_at IS NULL
             )) AS survey_has_opened
     FROM pulse_link_invites pli
     WHERE pli.organization_id = $1
     ORDER BY lower(pli.email)`,
    [organizationId]
  );
  return rows;
}

export async function getInviteInOrg(inviteId, organizationId) {
  const { rows } = await query(
    `SELECT * FROM pulse_link_invites WHERE id = $1 AND organization_id = $2`,
    [inviteId, organizationId]
  );
  return rows[0] || null;
}

export async function findByTokenHash(tokenHash) {
  const { rows } = await query(`SELECT * FROM pulse_link_invites WHERE token_hash = $1`, [tokenHash]);
  return rows[0] || null;
}

export async function upsertInviteRow({ organizationId, displayName, email, surveyRole = 'staff' }) {
  const em = normalizeEmail(email);
  if (!em) return { row: null, error: 'invalid_email' };
  const role = surveyRole === 'manager' ? 'manager' : 'staff';
  const name = String(displayName || '').trim();
  const { rows } = await query(
    `INSERT INTO pulse_link_invites (organization_id, display_name, email, survey_role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (organization_id, email) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       survey_role = EXCLUDED.survey_role,
       updated_at = NOW()
     RETURNING *`,
    [organizationId, name, em, role]
  );
  return { row: rows[0], error: null };
}

/**
 * Rotates token and sets last_invited_at. Returns raw token for the email link.
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

export async function deleteInviteInOrg(inviteId, organizationId) {
  const { rowCount } = await query(
    `DELETE FROM pulse_link_invites WHERE id = $1 AND organization_id = $2`,
    [inviteId, organizationId]
  );
  return rowCount > 0;
}

export async function rotateTokenAndMarkSent(inviteId, organizationId) {
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
