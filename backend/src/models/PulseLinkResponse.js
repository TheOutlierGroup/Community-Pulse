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
    `INSERT INTO pulse_link_responses (invite_id, session_id) VALUES ($1, $2)
     ON CONFLICT (invite_id, session_id) DO NOTHING`,
    [inviteId, sessionId]
  );
}

export async function listResponsesForSession(sessionId) {
  const { rows } = await query(
    `SELECT plr.*, pli.email, pli.display_name
     FROM pulse_link_responses plr
     JOIN pulse_link_invites pli ON pli.id = plr.invite_id
     WHERE plr.session_id = $1`,
    [sessionId]
  );
  return rows;
}
