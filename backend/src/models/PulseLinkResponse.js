import { query } from '../config/database.js';

export async function getResponse(inviteId, sessionId) {
  const { rows } = await query(
    `SELECT * FROM pulse_link_responses WHERE invite_id = $1 AND session_id = $2`,
    [inviteId, sessionId]
  );
  return rows[0] || null;
}

export async function upsertResponseDraft({
  inviteId,
  sessionId,
  currentStep,
  step1,
  step2,
  step3,
  step4,
}) {
  const { rows } = await query(
    `INSERT INTO pulse_link_responses
      (invite_id, session_id, current_step, step1_data, step2_data, step3_data, step4_data, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, NOW())
     ON CONFLICT (invite_id, session_id) DO UPDATE SET
       current_step = EXCLUDED.current_step,
       step1_data = EXCLUDED.step1_data,
       step2_data = EXCLUDED.step2_data,
       step3_data = EXCLUDED.step3_data,
       step4_data = EXCLUDED.step4_data,
       survey_started_at = COALESCE(pulse_link_responses.survey_started_at, NOW()),
       updated_at = NOW()
     RETURNING *`,
    [
      inviteId,
      sessionId,
      currentStep,
      JSON.stringify(step1 || {}),
      JSON.stringify(step2 || {}),
      JSON.stringify(step3 || {}),
      JSON.stringify(step4 || {}),
    ]
  );
  return rows[0];
}

export async function completeResponse({
  inviteId,
  sessionId,
  step1,
  step2,
  step3,
  step4,
  contributionStyle,
}) {
  const { rows } = await query(
    `UPDATE pulse_link_responses SET
       current_step = 5,
       step1_data = $3::jsonb,
       step2_data = $4::jsonb,
       step3_data = $5::jsonb,
       step4_data = $6::jsonb,
       contribution_style = $7,
       survey_started_at = COALESCE(survey_started_at, NOW()),
       completed_at = NOW(),
       updated_at = NOW()
     WHERE invite_id = $1 AND session_id = $2
     RETURNING *`,
    [
      inviteId,
      sessionId,
      JSON.stringify(step1 || {}),
      JSON.stringify(step2 || {}),
      JSON.stringify(step3 || {}),
      JSON.stringify(step4 || {}),
      contributionStyle,
    ]
  );
  return rows[0] || null;
}

export async function ensureResponseRow(inviteId, sessionId) {
  await query(
    `INSERT INTO pulse_link_responses (invite_id, session_id, link_opened_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (invite_id, session_id) DO UPDATE SET
       link_opened_at = COALESCE(pulse_link_responses.link_opened_at, NOW())`,
    [inviteId, sessionId]
  );
}

export async function markSurveyStarted(inviteId, sessionId) {
  const { rows } = await query(
    `UPDATE pulse_link_responses SET
       survey_started_at = COALESCE(survey_started_at, NOW()),
       updated_at = NOW()
     WHERE invite_id = $1 AND session_id = $2
     RETURNING *`,
    [inviteId, sessionId]
  );
  return rows[0] || null;
}

/** Clears draft / in-progress Pulse data when a link is (re)sent so status resets; completed surveys stay. */
export async function deleteIncompleteForInvite(inviteId) {
  await query(`DELETE FROM pulse_link_responses WHERE invite_id = $1 AND completed_at IS NULL`, [
    inviteId,
  ]);
}

export async function listResponsesForSession(sessionId) {
  const { rows } = await query(
    `SELECT plr.*,
            pli.email,
            pli.display_name,
            pli.survey_role,
            pli.manager_invite_id,
            mgr.display_name AS manager_display_name,
            mgr.email AS manager_email
     FROM pulse_link_responses plr
     JOIN pulse_link_invites pli ON pli.id = plr.invite_id
     LEFT JOIN pulse_link_invites mgr
       ON mgr.id = pli.manager_invite_id
      AND mgr.organization_id = pli.organization_id
     WHERE plr.session_id = $1`,
    [sessionId]
  );
  return rows;
}
