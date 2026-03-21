import { query } from '../config/database.js';

export async function upsertActionPlan(sessionId, organizationId, planData) {
  const { rows } = await query(
    `INSERT INTO action_plans (session_id, organization_id, plan_data, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (session_id) DO UPDATE SET
       plan_data = EXCLUDED.plan_data,
       updated_at = NOW()
     RETURNING *`,
    [sessionId, organizationId, JSON.stringify(planData)]
  );
  return rows[0];
}

export async function getActionPlan(sessionId, organizationId) {
  const { rows } = await query(
    `SELECT * FROM action_plans WHERE session_id = $1 AND organization_id = $2`,
    [sessionId, organizationId]
  );
  return rows[0] || null;
}
