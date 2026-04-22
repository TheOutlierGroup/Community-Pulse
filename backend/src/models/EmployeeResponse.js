import { query } from '../config/database.js';
import { normalizePulseStage } from '../services/pulseStage.js';

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
  stage = 'pre',
  currentStep,
  step1,
  step2,
  step3,
  step4,
}) {
  const normalizedStage = normalizePulseStage(stage);
  const { rows } = await query(
    `INSERT INTO employee_responses
      (user_id, session_id, stage, current_step, step1_data, step2_data, step3_data, step4_data, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, NOW())
     ON CONFLICT (user_id, session_id) DO UPDATE SET
       stage = EXCLUDED.stage,
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
      normalizedStage,
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
  stage = 'pre',
  step1,
  step2,
  step3,
  step4,
  contributionStyle,
}) {
  const normalizedStage = normalizePulseStage(stage);
  const { rows } = await query(
    `UPDATE employee_responses SET
       stage = $3,
       current_step = 5,
       step1_data = $4::jsonb,
       step2_data = $5::jsonb,
       step3_data = $6::jsonb,
       step4_data = $7::jsonb,
       contribution_style = $8,
       completed_at = NOW(),
       updated_at = NOW()
     WHERE user_id = $1 AND session_id = $2
     RETURNING *`,
    [
      userId,
      sessionId,
      normalizedStage,
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
    `INSERT INTO employee_responses (user_id, session_id, stage) VALUES ($1, $2, 'pre')
     ON CONFLICT (user_id, session_id) DO UPDATE SET
       stage = COALESCE(employee_responses.stage, 'pre')`,
    [userId, sessionId]
  );
}
