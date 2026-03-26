import { query } from '../config/database.js';

export async function getResponse(userId, sessionId) {
  const { rows } = await query(
    `SELECT * FROM employee_responses WHERE user_id = $1 AND session_id = $2`,
    [userId, sessionId]
  );
  return rows[0] || null;
}

export async function upsertResponseDraft({
  userId,
  sessionId,
  currentStep,
  step1,
  step2,
  step3,
  step4,
}) {
  const { rows } = await query(
    `INSERT INTO employee_responses
      (user_id, session_id, current_step, step1_data, step2_data, step3_data, step4_data, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, NOW())
     ON CONFLICT (user_id, session_id) DO UPDATE SET
       current_step = EXCLUDED.current_step,
       step1_data = EXCLUDED.step1_data,
       step2_data = EXCLUDED.step2_data,
       step3_data = EXCLUDED.step3_data,
       step4_data = EXCLUDED.step4_data,
       updated_at = NOW()
     RETURNING *`,
    [
      userId,
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
  userId,
  sessionId,
  step1,
  step2,
  step3,
  step4,
  contributionStyle,
}) {
  const { rows } = await query(
    `UPDATE employee_responses SET
       current_step = 5,
       step1_data = $3::jsonb,
       step2_data = $4::jsonb,
       step3_data = $5::jsonb,
       step4_data = $6::jsonb,
       contribution_style = $7,
       completed_at = NOW(),
       updated_at = NOW()
     WHERE user_id = $1 AND session_id = $2
     RETURNING *`,
    [
      userId,
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

export async function listResponsesForSession(sessionId) {
  const { rows } = await query(
    `SELECT er.*, u.email, u.role
     FROM employee_responses er
     JOIN users u ON u.id = er.user_id
     WHERE er.session_id = $1`,
    [sessionId]
  );
  return rows;
}

export async function countParticipationForSession(sessionId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed
     FROM employee_responses
     WHERE session_id = $1`,
    [sessionId]
  );
  return {
    total: rows[0]?.total ?? 0,
    completed: rows[0]?.completed ?? 0,
  };
}

export async function ensureResponseRow(userId, sessionId) {
  await query(
    `INSERT INTO employee_responses (user_id, session_id) VALUES ($1, $2)
     ON CONFLICT (user_id, session_id) DO NOTHING`,
    [userId, sessionId]
  );
}
