import { query } from '../config/database.js';

export const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'archived'];

export const PROJECT_ACTIVITY_TYPES = {
  CREATED: 'created',
  STATUS_CHANGED: 'status_changed',
  CONVERTED_FROM_LEAD: 'converted_from_lead',
  TIME_LOGGED: 'time_logged',
  FIELD_UPDATED: 'field_updated',
};

// ── Projects ──────────────────────────────────────────────────────────────────

export async function createProject(organizationId, {
  businessUnitId, leadId = null, accountId = null, contactId = null,
  name, description, baselineHours = 0, baselineCost = 0,
  startDate = null, dueDate = null, createdBy = null,
}) {
  const { rows } = await query(
    `INSERT INTO projects
       (organization_id, business_unit_id, lead_id, account_id, contact_id,
        name, description, baseline_hours, baseline_cost,
        start_date, due_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      organizationId, businessUnitId, leadId, accountId, contactId,
      String(name).trim(), description || null,
      Number(baselineHours), Number(baselineCost),
      startDate || null, dueDate || null, createdBy || null,
    ]
  );
  return rows[0];
}

export async function getProject(id) {
  const { rows } = await query(
    `SELECT p.*,
            bu.name AS bu_name,
            a.name  AS account_name,
            c.first_name || ' ' || c.last_name AS contact_name,
            COALESCE(tl.actual_hours, 0)::numeric AS actual_hours,
            COALESCE(tl.actual_cost, 0)::numeric  AS actual_cost,
            (SELECT COUNT(*)::int FROM client_work_tasks t WHERE t.project_id = p.id) AS task_count
     FROM projects p
     JOIN business_units bu ON bu.id = p.business_unit_id
     LEFT JOIN accounts a ON a.id = p.account_id
     LEFT JOIN contacts c ON c.id = p.contact_id
     LEFT JOIN (
       SELECT project_id,
              SUM(hours)::numeric                  AS actual_hours,
              SUM(COALESCE(hours * cost_rate, 0))::numeric AS actual_cost
       FROM project_time_logs
       GROUP BY project_id
     ) tl ON tl.project_id = p.id
     WHERE p.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function listProjects(organizationId, {
  businessUnitId, status, leadId, search, limit = 50, offset = 0,
} = {}) {
  const cap = Math.min(Number(limit) || 50, 500);
  const off = Math.max(Number(offset) || 0, 0);
  const conditions = ['p.organization_id = $1'];
  const params = [organizationId];
  let p = 2;

  if (businessUnitId) { conditions.push(`p.business_unit_id = $${p++}`); params.push(businessUnitId); }
  if (status) { conditions.push(`p.status = $${p++}`); params.push(status); }
  if (leadId) { conditions.push(`p.lead_id = $${p++}`); params.push(leadId); }
  if (search) { conditions.push(`p.name ILIKE $${p++}`); params.push(`%${search}%`); }

  params.push(cap, off);
  const { rows } = await query(
    `SELECT p.*,
            bu.name AS bu_name,
            a.name  AS account_name,
            COALESCE(tl.actual_hours, 0)::numeric AS actual_hours,
            COALESCE(tl.actual_cost, 0)::numeric  AS actual_cost,
            (SELECT COUNT(*)::int FROM client_work_tasks t WHERE t.project_id = p.id) AS task_count
     FROM projects p
     JOIN business_units bu ON bu.id = p.business_unit_id
     LEFT JOIN accounts a ON a.id = p.account_id
     LEFT JOIN (
       SELECT project_id,
              SUM(hours)::numeric                  AS actual_hours,
              SUM(COALESCE(hours * cost_rate, 0))::numeric AS actual_cost
       FROM project_time_logs
       GROUP BY project_id
     ) tl ON tl.project_id = p.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY p.created_at DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    params
  );
  return rows;
}

export async function updateProject(id, { name, description, status, startDate, dueDate, completedAt } = {}) {
  const proj = await getProject(id);
  if (!proj) return null;
  const setCompletedAt =
    status === 'completed' && !proj.completed_at ? 'NOW()' :
    status && status !== 'completed' ? 'NULL' : null;

  const { rows } = await query(
    `UPDATE projects
     SET name          = COALESCE($2, name),
         description   = COALESCE($3, description),
         status        = COALESCE($4, status),
         start_date    = COALESCE($5, start_date),
         due_date      = COALESCE($6, due_date),
         completed_at  = ${setCompletedAt ? `${setCompletedAt}` : 'completed_at'},
         updated_at    = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, name || null, description !== undefined ? description : null, status || null, startDate !== undefined ? startDate : null, dueDate !== undefined ? dueDate : null]
  );
  return rows[0] || null;
}

export async function projectBelongsToOrg(projectId, organizationId) {
  const { rows } = await query(
    `SELECT 1 FROM projects WHERE id = $1 AND organization_id = $2`,
    [projectId, organizationId]
  );
  return rows.length > 0;
}

// ── Activity ──────────────────────────────────────────────────────────────────

export async function logActivity(projectId, actorId, eventType, payload = {}) {
  await query(
    `INSERT INTO project_activity (project_id, actor_id, event_type, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [projectId, actorId || null, eventType, JSON.stringify(payload)]
  );
}

export async function listActivity(projectId, { limit = 50, offset = 0 } = {}) {
  const { rows } = await query(
    `SELECT pa.*, u.email AS actor_email,
            u.first_name AS actor_first_name, u.last_name AS actor_last_name
     FROM project_activity pa
     LEFT JOIN users u ON u.id = pa.actor_id
     WHERE pa.project_id = $1
     ORDER BY pa.created_at DESC
     LIMIT $2 OFFSET $3`,
    [projectId, Math.min(Number(limit) || 50, 200), Math.max(Number(offset) || 0, 0)]
  );
  return rows;
}

// ── Time logs ─────────────────────────────────────────────────────────────────

export async function addTimeLog(projectId, { taskId = null, userId, description, hours, costRate = null, loggedDate = null }) {
  const { rows } = await query(
    `INSERT INTO project_time_logs
       (project_id, task_id, user_id, description, hours, cost_rate, logged_date)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, CURRENT_DATE))
     RETURNING *`,
    [projectId, taskId || null, userId || null, description || null, Number(hours), costRate != null ? Number(costRate) : null, loggedDate || null]
  );
  return rows[0];
}

export async function listTimeLogs(projectId, { taskId, userId, limit = 100, offset = 0 } = {}) {
  const conditions = ['tl.project_id = $1'];
  const params = [projectId];
  let p = 2;
  if (taskId) { conditions.push(`tl.task_id = $${p++}`); params.push(taskId); }
  if (userId) { conditions.push(`tl.user_id = $${p++}`); params.push(userId); }
  params.push(Math.min(Number(limit) || 100, 500), Math.max(Number(offset) || 0, 0));

  const { rows } = await query(
    `SELECT tl.*,
            u.email AS user_email, u.first_name AS user_first_name, u.last_name AS user_last_name,
            t.title AS task_title,
            (tl.hours * COALESCE(tl.cost_rate, 0))::numeric AS line_cost
     FROM project_time_logs tl
     LEFT JOIN users u ON u.id = tl.user_id
     LEFT JOIN client_work_tasks t ON t.id = tl.task_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY tl.logged_date DESC, tl.created_at DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    params
  );
  return rows;
}

export async function updateTimeLog(id, { description, hours, costRate, loggedDate } = {}) {
  const { rows } = await query(
    `UPDATE project_time_logs
     SET description = COALESCE($2, description),
         hours       = COALESCE($3, hours),
         cost_rate   = COALESCE($4, cost_rate),
         logged_date = COALESCE($5, logged_date),
         updated_at  = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, description !== undefined ? description : null, hours != null ? Number(hours) : null, costRate !== undefined ? (costRate != null ? Number(costRate) : null) : undefined, loggedDate || null]
  );
  return rows[0] || null;
}

export async function deleteTimeLog(id) {
  await query(`DELETE FROM project_time_logs WHERE id = $1`, [id]);
}

export async function getTimeSummary(projectId) {
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(hours), 0)::numeric                         AS actual_hours,
       COALESCE(SUM(hours * COALESCE(cost_rate, 0)), 0)::numeric AS actual_cost,
       COUNT(*)::int                                             AS entry_count
     FROM project_time_logs WHERE project_id = $1`,
    [projectId]
  );
  return {
    actualHours: Number(rows[0]?.actual_hours || 0),
    actualCost: Number(rows[0]?.actual_cost || 0),
    entryCount: Number(rows[0]?.entry_count || 0),
  };
}
