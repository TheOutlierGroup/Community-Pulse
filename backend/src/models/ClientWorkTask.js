import { query } from '../config/database.js';

const TITLE_MAX = 500;
const BODY_MAX = 8000;

function trimTitle(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return s.slice(0, TITLE_MAX);
}

function trimBody(v) {
  if (v == null) return '';
  return String(v).trim().slice(0, BODY_MAX);
}

export async function listTasksForClientOrg(organizationId) {
  const { rows } = await query(
    `SELECT t.id, t.organization_id, t.title, t.body, t.status, t.created_at, t.updated_at,
            t.created_by, u.email AS created_by_email
     FROM client_work_tasks t
     LEFT JOIN users u ON u.id = t.created_by
     WHERE t.organization_id = $1
     ORDER BY (CASE WHEN t.status = 'open' THEN 0 ELSE 1 END), t.created_at DESC`,
    [organizationId]
  );
  return rows;
}

export async function createTask(organizationId, { title, body }, createdByUserId) {
  const t = trimTitle(title);
  if (!t) return null;
  const b = trimBody(body);
  const { rows } = await query(
    `INSERT INTO client_work_tasks (organization_id, title, body, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [organizationId, t, b, createdByUserId]
  );
  const id = rows[0]?.id;
  if (!id) return null;
  return getTaskWithCreator(id, organizationId);
}

export async function getTaskForOrg(taskId, organizationId) {
  const { rows } = await query(
    `SELECT * FROM client_work_tasks WHERE id = $1 AND organization_id = $2`,
    [taskId, organizationId]
  );
  return rows[0] || null;
}

export async function updateTaskForOrg(taskId, organizationId, patch) {
  const existing = await getTaskForOrg(taskId, organizationId);
  if (!existing) return null;
  const parts = [];
  const vals = [];
  let n = 1;
  if ('title' in patch) {
    const t = trimTitle(patch.title);
    if (!t) return null;
    parts.push(`title = $${n++}`);
    vals.push(t);
  }
  if ('body' in patch) {
    parts.push(`body = $${n++}`);
    vals.push(trimBody(patch.body));
  }
  if ('status' in patch) {
    const s = patch.status === 'done' ? 'done' : 'open';
    parts.push(`status = $${n++}`);
    vals.push(s);
  }
  if (!parts.length) return getTaskWithCreator(taskId, organizationId);
  parts.push(`updated_at = NOW()`);
  vals.push(taskId, organizationId);
  const { rows } = await query(
    `UPDATE client_work_tasks SET ${parts.join(', ')}
     WHERE id = $${n++} AND organization_id = $${n++}
     RETURNING id`,
    vals
  );
  if (!rows.length) return null;
  return getTaskWithCreator(taskId, organizationId);
}

export async function deleteTaskForOrg(taskId, organizationId) {
  const { rowCount } = await query(
    `DELETE FROM client_work_tasks WHERE id = $1 AND organization_id = $2`,
    [taskId, organizationId]
  );
  return rowCount > 0;
}

async function getTaskWithCreator(taskId, organizationId) {
  const { rows } = await query(
    `SELECT t.id, t.organization_id, t.title, t.body, t.status, t.created_at, t.updated_at,
            t.created_by, u.email AS created_by_email
     FROM client_work_tasks t
     LEFT JOIN users u ON u.id = t.created_by
     WHERE t.id = $1 AND t.organization_id = $2`,
    [taskId, organizationId]
  );
  return rows[0] || null;
}
