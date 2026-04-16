import { randomUUID } from 'crypto';
import { pool, query } from '../config/database.js';

const TITLE_MAX = 500;
const BODY_MAX = 8000;
const COMMENT_BODY_MAX = 8000;
const MAX_TAGGED_USERS = 50;
const MAX_MENTION_USERS = 20;

export const TASK_BOARD_STATUSES = ['todo', 'working', 'review', 'completed'];

function normalizeTaskStatus(s) {
  return TASK_BOARD_STATUSES.includes(s) ? s : 'todo';
}

function trimTitle(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return s.slice(0, TITLE_MAX);
}

function trimBody(v) {
  if (v == null) return '';
  return String(v).trim().slice(0, BODY_MAX);
}

function trimCommentBody(v) {
  if (v == null) return '';
  return String(v).trim().slice(0, COMMENT_BODY_MAX);
}

/** null = clear, undefined = skip, string YYYY-MM-DD = set, invalid = bad */
function parseDateInput(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return s;
}

const LIST_SELECT = `
  SELECT t.id, t.organization_id, t.title, t.body, t.status, t.position,
         t.start_date, t.due_date, t.assigned_to,
         t.created_at, t.updated_at, t.created_by,
         u.email AS created_by_email,
         u.first_name AS created_by_first_name,
         u.last_name AS created_by_last_name,
         ua.id AS assignee_id, ua.email AS assignee_email,
         ua.first_name AS assignee_first_name, ua.last_name AS assignee_last_name,
         oa.kind AS assignee_org_kind,
         (SELECT COUNT(*)::int FROM client_work_task_images i WHERE i.task_id = t.id) AS image_count,
         (SELECT COUNT(*)::int FROM client_work_task_comments c WHERE c.task_id = t.id) AS comment_count,
         (SELECT COUNT(*)::int FROM client_work_task_checklist_items ci WHERE ci.task_id = t.id) AS checklist_count,
         COALESCE(
           (SELECT json_agg(
              json_build_object(
                'id', tu.id,
                'email', tu.email,
                'firstName', tu.first_name,
                'lastName', tu.last_name,
                'organizationKind', tou.kind
              ) ORDER BY tu.email
            )
            FROM client_work_task_tags tt
            JOIN users tu ON tu.id = tt.user_id
            JOIN organizations tou ON tou.id = tu.organization_id
            WHERE tt.task_id = t.id),
           '[]'::json
         ) AS tagged_users_json,
         COALESCE(
           (SELECT json_agg(
              json_build_object('id', lb.id, 'name', lb.name) ORDER BY lb.created_at ASC
            )
            FROM client_work_task_labels lb
            WHERE lb.task_id = t.id),
           '[]'::json
         ) AS labels_json
  FROM client_work_tasks t
  LEFT JOIN users u ON u.id = t.created_by
  LEFT JOIN users ua ON ua.id = t.assigned_to
  LEFT JOIN organizations oa ON oa.id = ua.organization_id
`;

const TASK_LIST_ORDER_BY = `
  ORDER BY
    CASE t.status
      WHEN 'todo' THEN 0
      WHEN 'working' THEN 1
      WHEN 'review' THEN 2
      WHEN 'completed' THEN 3
      ELSE 4
    END,
    t.position ASC,
    t.created_at ASC
`;

export async function listTasksForClientOrg(organizationId, { limit, offset } = {}) {
  const cappedLimit =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 200;
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const { rows } = await query(
    `WITH scoped_tasks AS (
       SELECT t.id, t.organization_id, t.title, t.body, t.status, t.position,
              t.start_date, t.due_date, t.assigned_to, t.created_at, t.updated_at, t.created_by
       FROM client_work_tasks t
       WHERE t.organization_id = $1
       ${TASK_LIST_ORDER_BY}
       LIMIT $2 OFFSET $3
     ),
     image_counts AS (
       SELECT i.task_id, COUNT(*)::int AS image_count
       FROM client_work_task_images i
       WHERE i.task_id IN (SELECT id FROM scoped_tasks)
       GROUP BY i.task_id
     ),
     comment_counts AS (
       SELECT c.task_id, COUNT(*)::int AS comment_count
       FROM client_work_task_comments c
       WHERE c.task_id IN (SELECT id FROM scoped_tasks)
       GROUP BY c.task_id
     ),
     checklist_counts AS (
       SELECT ci.task_id, COUNT(*)::int AS checklist_count
       FROM client_work_task_checklist_items ci
       WHERE ci.task_id IN (SELECT id FROM scoped_tasks)
       GROUP BY ci.task_id
     ),
     tagged_users AS (
       SELECT tt.task_id,
              json_agg(
                json_build_object(
                  'id', tu.id,
                  'email', tu.email,
                  'firstName', tu.first_name,
                  'lastName', tu.last_name,
                  'organizationKind', tou.kind
                )
                ORDER BY tu.email
              ) AS tagged_users_json
       FROM client_work_task_tags tt
       JOIN users tu ON tu.id = tt.user_id
       JOIN organizations tou ON tou.id = tu.organization_id
       WHERE tt.task_id IN (SELECT id FROM scoped_tasks)
       GROUP BY tt.task_id
     ),
     labels AS (
       SELECT lb.task_id,
              json_agg(
                json_build_object('id', lb.id, 'name', lb.name)
                ORDER BY lb.created_at ASC
              ) AS labels_json
       FROM client_work_task_labels lb
       WHERE lb.task_id IN (SELECT id FROM scoped_tasks)
       GROUP BY lb.task_id
     )
     SELECT t.id, t.organization_id, t.title, t.body, t.status, t.position,
            t.start_date, t.due_date, t.assigned_to,
            t.created_at, t.updated_at, t.created_by,
            u.email AS created_by_email,
            u.first_name AS created_by_first_name,
            u.last_name AS created_by_last_name,
            ua.id AS assignee_id, ua.email AS assignee_email,
            ua.first_name AS assignee_first_name, ua.last_name AS assignee_last_name,
            oa.kind AS assignee_org_kind,
            COALESCE(ic.image_count, 0) AS image_count,
            COALESCE(cc.comment_count, 0) AS comment_count,
            COALESCE(kc.checklist_count, 0) AS checklist_count,
            COALESCE(tu.tagged_users_json, '[]'::json) AS tagged_users_json,
            COALESCE(l.labels_json, '[]'::json) AS labels_json
     FROM scoped_tasks t
     LEFT JOIN users u ON u.id = t.created_by
     LEFT JOIN users ua ON ua.id = t.assigned_to
     LEFT JOIN organizations oa ON oa.id = ua.organization_id
     LEFT JOIN image_counts ic ON ic.task_id = t.id
     LEFT JOIN comment_counts cc ON cc.task_id = t.id
     LEFT JOIN checklist_counts kc ON kc.task_id = t.id
     LEFT JOIN tagged_users tu ON tu.task_id = t.id
     LEFT JOIN labels l ON l.task_id = t.id
     ${TASK_LIST_ORDER_BY}`,
    [organizationId, cappedLimit, safeOffset]
  );
  return rows;
}

export async function countTasksByStatusForOrg(organizationId) {
  const { rows } = await query(
    `SELECT status, COUNT(*)::int AS c
     FROM client_work_tasks
     WHERE organization_id = $1
     GROUP BY status`,
    [organizationId]
  );
  const base = { todo: 0, working: 0, review: 0, completed: 0 };
  for (const r of rows) {
    if (Object.prototype.hasOwnProperty.call(base, r.status)) {
      base[r.status] = r.c;
    }
  }
  return base;
}

export async function listTasksDueBetween(organizationId, startDate, endDate) {
  const { rows } = await query(
    `SELECT t.id, t.title, t.status, t.due_date,
            ua.id AS assignee_id, ua.email AS assignee_email,
            ua.first_name AS assignee_first_name, ua.last_name AS assignee_last_name
     FROM client_work_tasks t
     LEFT JOIN users ua ON ua.id = t.assigned_to
     WHERE t.organization_id = $1
       AND t.due_date IS NOT NULL
       AND t.due_date >= $2::date
       AND t.due_date <= $3::date
     ORDER BY t.due_date ASC, t.title ASC`,
    [organizationId, startDate, endDate]
  );
  return rows;
}

/** Tasks assigned to user with due date in range, across all client organizations. */
export async function listTasksDueBetweenForAssignee(userId, startDate, endDate) {
  const { rows } = await query(
    `SELECT t.id, t.organization_id, o.name AS organization_name, t.title, t.status, t.due_date
     FROM client_work_tasks t
     INNER JOIN organizations o ON o.id = t.organization_id AND o.kind = 'client'
     WHERE t.assigned_to = $1
       AND t.due_date IS NOT NULL
       AND t.due_date >= $2::date
       AND t.due_date <= $3::date
     ORDER BY t.due_date ASC, t.title ASC`,
    [userId, startDate, endDate]
  );
  return rows;
}

/** All tasks assigned to user across client orgs (for platform staff home). */
export async function listTasksAssignedToUserAcrossClientOrgs(userId) {
  const { rows } = await query(
    `SELECT t.id, t.organization_id, o.name AS organization_name, t.title, t.status, t.due_date, t.start_date
     FROM client_work_tasks t
     INNER JOIN organizations o ON o.id = t.organization_id AND o.kind = 'client'
     WHERE t.assigned_to = $1
     ORDER BY
       CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END,
       t.due_date ASC NULLS LAST,
       t.title ASC`,
    [userId]
  );
  return rows;
}

export async function countOpenTasksAssignedToUserAcrossClientOrgs(userId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS c
     FROM client_work_tasks t
     INNER JOIN organizations o ON o.id = t.organization_id AND o.kind = 'client'
     WHERE t.assigned_to = $1 AND t.status <> 'completed'`,
    [userId]
  );
  return rows[0]?.c ?? 0;
}

/** Platform staff: can open client org task APIs when they have real work on a card in that org. */
export async function platformUserHasStakeInClientOrgTasks(platformUserId, clientOrgId) {
  const { rows } = await query(
    `SELECT 1
     FROM client_work_tasks t
     WHERE t.organization_id = $1
       AND (
         t.assigned_to = $2
         OR t.created_by = $2
         OR EXISTS (SELECT 1 FROM client_work_task_tags tt WHERE tt.task_id = t.id AND tt.user_id = $2)
         OR EXISTS (
           SELECT 1 FROM client_work_task_watchers w
           WHERE w.task_id = t.id AND w.organization_id = t.organization_id AND w.user_id = $2
         )
         OR EXISTS (
           SELECT 1 FROM client_work_task_comments c
           WHERE c.task_id = t.id AND c.organization_id = t.organization_id AND c.author_id = $2
         )
         OR EXISTS (
           SELECT 1 FROM client_work_task_comments c
           INNER JOIN client_work_task_comment_mentions m ON m.comment_id = c.id
           WHERE c.task_id = t.id AND c.organization_id = t.organization_id AND m.user_id = $2
         )
       )
     LIMIT 1`,
    [clientOrgId, platformUserId]
  );
  return rows.length > 0;
}

export async function getTaskListRow(taskId, organizationId) {
  const { rows } = await query(`${LIST_SELECT} WHERE t.organization_id = $1 AND t.id = $2`, [
    organizationId,
    taskId,
  ]);
  return rows[0] || null;
}

export async function createTask(
  organizationId,
  { title, body, notes, startDate, dueDate, assignedTo, taggedUserIds, status },
  createdByUserId
) {
  const t = trimTitle(title);
  if (!t) return null;
  const b = trimBody(notes !== undefined ? notes : body);
  const sd = parseDateInput(startDate);
  const dd = parseDateInput(dueDate);
  if (sd === false || dd === false) return null;
  const st = normalizeTaskStatus(status);

  const { rows: posRows } = await query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
     FROM client_work_tasks WHERE organization_id = $1 AND status = $2`,
    [organizationId, st]
  );
  const nextPos = posRows[0]?.next_pos ?? 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO client_work_tasks (
         organization_id, title, body, created_by, status, position,
         start_date, due_date, assigned_to
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        organizationId,
        t,
        b,
        createdByUserId,
        st,
        nextPos,
        sd === undefined ? null : sd,
        dd === undefined ? null : dd,
        assignedTo || null,
      ]
    );
    const id = rows[0]?.id;
    if (!id) throw new Error('no id');
    if (taggedUserIds?.length) {
      await replaceTaskTagsInClient(client, id, taggedUserIds);
    }
    await client.query('COMMIT');
    return getTaskListRow(id, organizationId);
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return null;
  } finally {
    client.release();
  }
}

async function replaceTaskTagsInClient(client, taskId, userIds) {
  const unique = [...new Set(userIds.map((x) => String(x)))].slice(0, MAX_TAGGED_USERS);
  await client.query(`DELETE FROM client_work_task_tags WHERE task_id = $1`, [taskId]);
  for (const uid of unique) {
    await client.query(
      `INSERT INTO client_work_task_tags (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [taskId, uid]
    );
  }
}

export async function replaceTaskTags(taskId, organizationId, userIds) {
  const task = await getTaskForOrg(taskId, organizationId);
  if (!task) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await replaceTaskTagsInClient(client, taskId, userIds || []);
    await client.query('COMMIT');
    return true;
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return false;
  } finally {
    client.release();
  }
}

const MAX_CARD_LABELS = 25;
const MAX_CARD_LABEL_LEN = 80;
const MAX_CHECKLIST_ITEM_LEN = 2000;

function normalizeCardLabelNames(rawNames) {
  if (!Array.isArray(rawNames)) return null;
  const seen = new Set();
  const names = [];
  for (const raw of rawNames) {
    const s = String(raw ?? '').trim().slice(0, MAX_CARD_LABEL_LEN);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(s);
    if (names.length > MAX_CARD_LABELS) return null;
  }
  return names;
}

export async function replaceTaskCardLabels(taskId, organizationId, rawNames) {
  const task = await getTaskForOrg(taskId, organizationId);
  if (!task) return false;
  const names = normalizeCardLabelNames(rawNames);
  if (names === null) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM client_work_task_labels WHERE task_id = $1 AND organization_id = $2`, [
      taskId,
      organizationId,
    ]);
    for (const name of names) {
      await client.query(
        `INSERT INTO client_work_task_labels (task_id, organization_id, name) VALUES ($1, $2, $3)`,
        [taskId, organizationId, name]
      );
    }
    await client.query('COMMIT');
    return true;
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return false;
  } finally {
    client.release();
  }
}

/** Distinct label strings already used on any task in the org (for pick lists). */
export async function listDistinctCardLabelNamesForOrg(organizationId) {
  const { rows } = await query(
    `SELECT MIN(btrim(name)) AS name
     FROM client_work_task_labels
     WHERE organization_id = $1
     GROUP BY lower(btrim(name))
     ORDER BY lower(MIN(btrim(name)))`,
    [organizationId]
  );
  return rows.map((r) => r.name).filter((n) => n && String(n).trim());
}

export async function listChecklistItemsForTask(taskId, organizationId) {
  const { rows } = await query(
    `SELECT id, task_id, body, done, sort_order, created_at
     FROM client_work_task_checklist_items
     WHERE task_id = $1 AND organization_id = $2
     ORDER BY sort_order ASC, created_at ASC`,
    [taskId, organizationId]
  );
  return rows;
}

export async function addChecklistItem(taskId, organizationId, text) {
  const task = await getTaskForOrg(taskId, organizationId);
  if (!task) return null;
  const body = String(text ?? '').trim().slice(0, MAX_CHECKLIST_ITEM_LEN);
  if (!body) return null;
  const { rows: maxR } = await query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM client_work_task_checklist_items WHERE task_id = $1`,
    [taskId]
  );
  const sortOrder = maxR[0]?.n ?? 0;
  const { rows } = await query(
    `INSERT INTO client_work_task_checklist_items (task_id, organization_id, body, sort_order)
     VALUES ($1, $2, $3, $4)
     RETURNING id, body, done, sort_order, created_at`,
    [taskId, organizationId, body, sortOrder]
  );
  return rows[0] || null;
}

export async function updateChecklistItemForOrg(itemId, taskId, organizationId, patch) {
  const { rows: existingRows } = await query(
    `SELECT id FROM client_work_task_checklist_items
     WHERE id = $1 AND task_id = $2 AND organization_id = $3`,
    [itemId, taskId, organizationId]
  );
  if (!existingRows.length) return null;
  const parts = [];
  const vals = [];
  let n = 1;
  if ('text' in patch) {
    const body = String(patch.text ?? '').trim().slice(0, MAX_CHECKLIST_ITEM_LEN);
    if (!body) return null;
    parts.push(`body = $${n++}`);
    vals.push(body);
  }
  if ('done' in patch) {
    parts.push(`done = $${n++}`);
    vals.push(Boolean(patch.done));
  }
  if (!parts.length) {
    const rows = await listChecklistItemsForTask(taskId, organizationId);
    return rows.find((r) => String(r.id) === String(itemId)) || null;
  }
  vals.push(itemId, taskId, organizationId);
  const { rows } = await query(
    `UPDATE client_work_task_checklist_items SET ${parts.join(', ')}
     WHERE id = $${n++} AND task_id = $${n++} AND organization_id = $${n++}
     RETURNING id, body, done, sort_order, created_at`,
    vals
  );
  return rows[0] || null;
}

export async function deleteChecklistItemForOrg(itemId, taskId, organizationId) {
  const { rowCount } = await query(
    `DELETE FROM client_work_task_checklist_items
     WHERE id = $1 AND task_id = $2 AND organization_id = $3`,
    [itemId, taskId, organizationId]
  );
  return rowCount > 0;
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
    const ti = trimTitle(patch.title);
    if (!ti) return null;
    parts.push(`title = $${n++}`);
    vals.push(ti);
  }
  if ('body' in patch || 'notes' in patch) {
    const raw = 'notes' in patch ? patch.notes : patch.body;
    parts.push(`body = $${n++}`);
    vals.push(trimBody(raw));
  }
  if ('status' in patch) {
    const s = normalizeTaskStatus(patch.status);
    parts.push(`status = $${n++}`);
    vals.push(s);
    if (s !== existing.status && !('position' in patch)) {
      const { rows: posRows } = await query(
        `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
         FROM client_work_tasks
         WHERE organization_id = $1 AND status = $2`,
        [organizationId, s]
      );
      parts.push(`position = $${n++}`);
      vals.push(posRows[0]?.next_pos ?? 0);
    }
  }
  if ('position' in patch) {
    const p = Number(patch.position);
    if (!Number.isInteger(p) || p < 0) return null;
    parts.push(`position = $${n++}`);
    vals.push(p);
  }
  if ('startDate' in patch) {
    const sd = parseDateInput(patch.startDate);
    if (sd === false) return null;
    if (sd !== undefined) {
      parts.push(`start_date = $${n++}`);
      vals.push(sd);
    }
  }
  if ('dueDate' in patch) {
    const dd = parseDateInput(patch.dueDate);
    if (dd === false) return null;
    if (dd !== undefined) {
      parts.push(`due_date = $${n++}`);
      vals.push(dd);
    }
  }
  if ('assignedTo' in patch) {
    parts.push(`assigned_to = $${n++}`);
    vals.push(patch.assignedTo ? String(patch.assignedTo) : null);
  }
  if (!parts.length && !('taggedUserIds' in patch) && !('labels' in patch)) {
    return getTaskListRow(taskId, organizationId);
  }
  if (parts.length) {
    parts.push(`updated_at = NOW()`);
    vals.push(taskId, organizationId);
    const { rows } = await query(
      `UPDATE client_work_tasks SET ${parts.join(', ')}
       WHERE id = $${n++} AND organization_id = $${n++}
       RETURNING id`,
      vals
    );
    if (!rows.length) return null;
  }
  if ('taggedUserIds' in patch) {
    const ok = await replaceTaskTags(taskId, organizationId, patch.taggedUserIds);
    if (!ok) return null;
  }
  if ('labels' in patch) {
    const ok = await replaceTaskCardLabels(taskId, organizationId, patch.labels);
    if (!ok) return null;
  }
  return getTaskListRow(taskId, organizationId);
}

export async function deleteTaskForOrg(taskId, organizationId) {
  const { rowCount } = await query(
    `DELETE FROM client_work_tasks WHERE id = $1 AND organization_id = $2`,
    [taskId, organizationId]
  );
  return rowCount > 0;
}

export async function reorderTasksForOrg(organizationId, updates) {
  if (!Array.isArray(updates) || updates.length === 0) return false;
  const { rows: existingRows } = await query(
    `SELECT id FROM client_work_tasks WHERE organization_id = $1`,
    [organizationId]
  );
  const idSet = new Set(existingRows.map((r) => String(r.id)));
  if (updates.length !== existingRows.length) return false;
  const seen = new Set();
  const statuses = [];
  const positions = [];
  const ids = [];
  for (const u of updates) {
    const id = String(u.id);
    if (!idSet.has(id) || seen.has(id)) return false;
    if (!TASK_BOARD_STATUSES.includes(u.status)) return false;
    const p = Number(u.position);
    if (!Number.isInteger(p) || p < 0) return false;
    seen.add(id);
    statuses.push(u.status);
    positions.push(p);
    ids.push(id);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `UPDATE client_work_tasks AS t
       SET status = src.status,
           position = src.position,
           updated_at = NOW()
       FROM (
         SELECT unnest($1::uuid[]) AS id,
                unnest($2::text[]) AS status,
                unnest($3::int[]) AS position
       ) AS src
       WHERE t.id = src.id
         AND t.organization_id = $4`,
      [ids, statuses, positions, organizationId]
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

export async function listTaskImages(taskId, organizationId) {
  const { rows } = await query(
    `SELECT id, task_id, stored_filename, created_at, sort_order, created_by
     FROM client_work_task_images
     WHERE task_id = $1 AND organization_id = $2
     ORDER BY sort_order ASC, created_at ASC`,
    [taskId, organizationId]
  );
  return rows;
}

export async function addTaskImage(taskId, organizationId, storedFilename, createdByUserId) {
  const task = await getTaskForOrg(taskId, organizationId);
  if (!task) return null;
  const { rows: maxR } = await query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM client_work_task_images WHERE task_id = $1`,
    [taskId]
  );
  const sortOrder = maxR[0]?.n ?? 0;
  const { rows } = await query(
    `INSERT INTO client_work_task_images (task_id, organization_id, stored_filename, created_by, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, task_id, stored_filename, created_at, sort_order, created_by`,
    [taskId, organizationId, storedFilename, createdByUserId, sortOrder]
  );
  return rows[0] || null;
}

export async function getTaskImageForOrg(imageId, taskId, organizationId) {
  const { rows } = await query(
    `SELECT * FROM client_work_task_images
     WHERE id = $1 AND task_id = $2 AND organization_id = $3`,
    [imageId, taskId, organizationId]
  );
  return rows[0] || null;
}

export async function deleteTaskImage(imageId, taskId, organizationId) {
  const { rows } = await query(
    `DELETE FROM client_work_task_images
     WHERE id = $1 AND task_id = $2 AND organization_id = $3
     RETURNING stored_filename`,
    [imageId, taskId, organizationId]
  );
  return rows[0]?.stored_filename || null;
}

export async function listCommentsForTask(taskId, organizationId) {
  const { rows } = await query(
    `SELECT c.id, c.task_id, c.body, c.created_at, c.updated_at, c.author_id,
            u.email AS author_email, u.first_name AS author_first_name, u.last_name AS author_last_name,
            ou.kind AS author_org_kind
     FROM client_work_task_comments c
     LEFT JOIN users u ON u.id = c.author_id
     LEFT JOIN organizations ou ON ou.id = u.organization_id
     WHERE c.task_id = $1 AND c.organization_id = $2
     ORDER BY c.created_at ASC`,
    [taskId, organizationId]
  );
  return rows;
}

export async function listCommentMentions(commentIds) {
  if (!commentIds.length) return [];
  const { rows } = await query(
    `SELECT m.comment_id, m.user_id, u.email, u.first_name, u.last_name, o.kind AS organization_kind
     FROM client_work_task_comment_mentions m
     JOIN users u ON u.id = m.user_id
     JOIN organizations o ON o.id = u.organization_id
     WHERE m.comment_id = ANY($1::uuid[])`,
    [commentIds]
  );
  return rows;
}

export async function listCommentImagesForTask(taskId, organizationId) {
  const { rows } = await query(
    `SELECT ci.id, ci.comment_id, ci.stored_filename, ci.created_at
     FROM client_work_task_comment_images ci
     JOIN client_work_task_comments c ON c.id = ci.comment_id
     WHERE c.task_id = $1 AND ci.organization_id = $2
     ORDER BY ci.created_at ASC`,
    [taskId, organizationId]
  );
  return rows;
}

export async function createComment(taskId, organizationId, authorId, body, mentionUserIds) {
  const task = await getTaskForOrg(taskId, organizationId);
  if (!task) return null;
  const b = trimCommentBody(body);
  const mentions = [...new Set((mentionUserIds || []).map((x) => String(x)))].slice(0, MAX_MENTION_USERS);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO client_work_task_comments (task_id, organization_id, author_id, body)
       VALUES ($1, $2, $3, $4)
       RETURNING id, task_id, body, created_at, updated_at, author_id`,
      [taskId, organizationId, authorId, b]
    );
    const comment = rows[0];
    for (const uid of mentions) {
      await client.query(
        `INSERT INTO client_work_task_comment_mentions (comment_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [comment.id, uid]
      );
    }
    await client.query('COMMIT');
    return comment.id;
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return null;
  } finally {
    client.release();
  }
}

export async function getCommentForOrg(commentId, taskId, organizationId) {
  const { rows } = await query(
    `SELECT * FROM client_work_task_comments
     WHERE id = $1 AND task_id = $2 AND organization_id = $3`,
    [commentId, taskId, organizationId]
  );
  return rows[0] || null;
}

export async function addCommentImage(commentId, taskId, organizationId, storedFilename) {
  const c = await getCommentForOrg(commentId, taskId, organizationId);
  if (!c) return null;
  const { rows } = await query(
    `INSERT INTO client_work_task_comment_images (comment_id, organization_id, stored_filename)
     VALUES ($1, $2, $3)
     RETURNING id, comment_id, stored_filename, created_at`,
    [commentId, organizationId, storedFilename]
  );
  return rows[0] || null;
}

export async function getCommentImageForOrg(imageId, commentId, taskId, organizationId) {
  const { rows } = await query(
    `SELECT ci.* FROM client_work_task_comment_images ci
     JOIN client_work_task_comments c ON c.id = ci.comment_id
     WHERE ci.id = $1 AND ci.comment_id = $2 AND c.task_id = $3 AND ci.organization_id = $4`,
    [imageId, commentId, taskId, organizationId]
  );
  return rows[0] || null;
}

export async function deleteCommentImage(imageId, commentId, taskId, organizationId) {
  const { rows } = await query(
    `DELETE FROM client_work_task_comment_images ci
     USING client_work_task_comments c
     WHERE ci.id = $1 AND ci.comment_id = $2 AND c.task_id = $3 AND ci.organization_id = $4
       AND c.id = ci.comment_id
     RETURNING ci.stored_filename`,
    [imageId, commentId, taskId, organizationId]
  );
  return rows[0]?.stored_filename || null;
}

export async function addTaskWatcher(taskId, organizationId, userId) {
  await query(
    `INSERT INTO client_work_task_watchers (task_id, user_id, organization_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (task_id, user_id) DO NOTHING`,
    [taskId, userId, organizationId]
  );
}

export async function removeTaskWatcher(taskId, organizationId, userId) {
  await query(
    `DELETE FROM client_work_task_watchers
     WHERE task_id = $1 AND user_id = $2 AND organization_id = $3`,
    [taskId, userId, organizationId]
  );
}

export async function isUserWatchingTask(taskId, organizationId, userId) {
  const { rows } = await query(
    `SELECT 1 FROM client_work_task_watchers
     WHERE task_id = $1 AND user_id = $2 AND organization_id = $3`,
    [taskId, userId, organizationId]
  );
  return rows.length > 0;
}

export async function listWatcherUserIdsForTask(taskId, organizationId) {
  const { rows } = await query(
    `SELECT user_id FROM client_work_task_watchers WHERE task_id = $1 AND organization_id = $2`,
    [taskId, organizationId]
  );
  return rows.map((r) => String(r.user_id));
}

export function newTaskImageFilename(taskId, ext) {
  return `t-${taskId}-${randomUUID()}${ext || '.png'}`;
}

export function newCommentImageFilename(commentId, ext) {
  return `c-${commentId}-${randomUUID()}${ext || '.png'}`;
}
