import { pool, query } from '../config/database.js';

export const TASK_BOARD_STATUSES = ['todo', 'working', 'review', 'completed'];

function taskRowSelect() {
  return `SELECT t.id, t.organisation_id, t.title, t.status, t.position, t.tag,
                 t.assigned_to, t.due_date, t.created_by, t.created_at, t.updated_at,
                 u.email AS assignee_email, u.first_name AS assignee_first_name,
                 u.last_name AS assignee_last_name
            FROM crm_organisation_tasks t
            LEFT JOIN users u ON u.id = t.assigned_to`;
}

export async function listTasksForOrg(organisationId) {
  const { rows } = await query(
    `${taskRowSelect()} WHERE t.organisation_id = $1 ORDER BY t.position ASC, t.created_at ASC`,
    [organisationId]
  );
  return rows;
}

export async function getTaskForOrg(taskId, organisationId) {
  const { rows } = await query(
    `${taskRowSelect()} WHERE t.id = $1 AND t.organisation_id = $2`,
    [taskId, organisationId]
  );
  return rows[0] || null;
}

export async function countTasksByStatusForOrg(organisationId) {
  const { rows } = await query(
    `SELECT status, COUNT(*)::int AS c FROM crm_organisation_tasks WHERE organisation_id = $1 GROUP BY status`,
    [organisationId]
  );
  const counts = { todo: 0, working: 0, review: 0, completed: 0 };
  for (const row of rows) {
    if (counts[row.status] !== undefined) counts[row.status] = row.c;
  }
  return counts;
}

export async function createTask(organisationId, { title, status, assignedTo, dueDate, tag }, createdByUserId) {
  const normalizedStatus = TASK_BOARD_STATUSES.includes(status) ? status : 'todo';
  const { rows: positionRows } = await query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next_position
       FROM crm_organisation_tasks WHERE organisation_id = $1 AND status = $2`,
    [organisationId, normalizedStatus]
  );
  const position = positionRows[0]?.next_position ?? 0;
  const { rows } = await query(
    `INSERT INTO crm_organisation_tasks
       (organisation_id, title, status, position, assigned_to, due_date, tag, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [organisationId, title, normalizedStatus, position, assignedTo || null, dueDate || null, tag?.trim() || null, createdByUserId || null]
  );
  return getTaskForOrg(rows[0].id, organisationId);
}

export async function updateTask(taskId, organisationId, patch) {
  const allowed = { title: 'title', status: 'status', assignedTo: 'assigned_to', dueDate: 'due_date', tag: 'tag' };
  const sets = [];
  const values = [];
  let i = 1;
  for (const [key, column] of Object.entries(allowed)) {
    if (!(key in patch)) continue;
    if (key === 'status' && !TASK_BOARD_STATUSES.includes(patch.status)) continue;
    sets.push(`${column} = $${i++}`);
    values.push(patch[key] === '' ? null : patch[key] ?? null);
  }
  if (sets.length === 0) return getTaskForOrg(taskId, organisationId);
  sets.push(`updated_at = NOW()`);
  values.push(taskId, organisationId);
  const { rows } = await query(
    `UPDATE crm_organisation_tasks SET ${sets.join(', ')}
      WHERE id = $${i++} AND organisation_id = $${i++}
      RETURNING id`,
    values
  );
  if (!rows[0]) return null;
  return getTaskForOrg(taskId, organisationId);
}

export async function deleteTask(taskId, organisationId) {
  const { rowCount } = await query(
    `DELETE FROM crm_organisation_tasks WHERE id = $1 AND organisation_id = $2`,
    [taskId, organisationId]
  );
  return rowCount > 0;
}

export async function reorderTasks(organisationId, updates) {
  if (!Array.isArray(updates) || updates.length === 0) return false;
  const { rows: existingRows } = await query(
    `SELECT id FROM crm_organisation_tasks WHERE organisation_id = $1`,
    [organisationId]
  );
  const idSet = new Set(existingRows.map((r) => String(r.id)));
  if (updates.length !== existingRows.length) return false;

  const seen = new Set();
  const ids = [];
  const statuses = [];
  const positions = [];
  for (const u of updates) {
    const id = String(u.id);
    if (!idSet.has(id) || seen.has(id)) return false;
    if (!TASK_BOARD_STATUSES.includes(u.status)) return false;
    const p = Number(u.position);
    if (!Number.isInteger(p) || p < 0) return false;
    seen.add(id);
    ids.push(id);
    statuses.push(u.status);
    positions.push(p);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `UPDATE crm_organisation_tasks AS t
       SET status = src.status,
           position = src.position,
           updated_at = NOW()
       FROM (
         SELECT unnest($1::uuid[]) AS id,
                unnest($2::text[]) AS status,
                unnest($3::int[]) AS position
       ) AS src
       WHERE t.id = src.id
         AND t.organisation_id = $4`,
      [ids, statuses, positions, organisationId]
    );
    if (rowCount !== updates.length) throw new Error('reorder');
    await client.query('COMMIT');
    return true;
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return false;
  } finally {
    client.release();
  }
}
