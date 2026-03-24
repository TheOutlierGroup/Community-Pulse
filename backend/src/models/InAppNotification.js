import { query } from '../config/database.js';

export const NOTIFICATION_TYPES = {
  COMMENT_MENTION: 'comment_mention',
  TASK_ASSIGNED: 'task_assigned',
  WATCHED_COMMENT: 'task_watched_comment',
  WATCHED_UPDATE: 'task_watched_update',
};

export async function createNotification({
  userId,
  organizationId,
  type,
  taskId,
  commentId = null,
  actorUserId = null,
  title,
  body = null,
  metadata = {},
}) {
  const { rows } = await query(
    `INSERT INTO in_app_notifications (
       user_id, organization_id, type, task_id, comment_id, actor_user_id, title, body, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING id`,
    [
      userId,
      organizationId,
      type,
      taskId,
      commentId,
      actorUserId,
      title,
      body,
      JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {}),
    ]
  );
  return rows[0]?.id || null;
}

export async function countUnreadForUser(userId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS c FROM in_app_notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );
  return rows[0]?.c ?? 0;
}

const LIST_SELECT = `
  SELECT n.id, n.user_id, n.organization_id, n.type, n.task_id, n.comment_id, n.actor_user_id,
         n.title, n.body, n.read_at, n.created_at, n.metadata,
         o.name AS organization_name,
         au.first_name AS actor_first_name, au.last_name AS actor_last_name, au.email AS actor_email
  FROM in_app_notifications n
  JOIN organizations o ON o.id = n.organization_id
  LEFT JOIN users au ON au.id = n.actor_user_id
`;

export async function listForUser(userId, { limit = 40 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 40, 1), 100);
  const { rows } = await query(
    `${LIST_SELECT}
     WHERE n.user_id = $1
     ORDER BY n.created_at DESC
     LIMIT $2`,
    [userId, lim]
  );
  return rows;
}

export async function markRead(notificationId, userId) {
  const { rowCount } = await query(
    `UPDATE in_app_notifications SET read_at = NOW()
     WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
    [notificationId, userId]
  );
  return rowCount > 0;
}

export async function markAllReadForUser(userId) {
  await query(`UPDATE in_app_notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`, [
    userId,
  ]);
}

export function publicNotification(row) {
  let meta = row.metadata;
  if (meta && typeof meta === 'string') {
    try {
      meta = JSON.parse(meta);
    } catch {
      meta = {};
    }
  }
  if (!meta || typeof meta !== 'object') meta = {};
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name ?? '',
    type: row.type,
    taskId: row.task_id,
    commentId: row.comment_id,
    actorUserId: row.actor_user_id,
    actor: row.actor_user_id
      ? {
          id: row.actor_user_id,
          email: row.actor_email ?? '',
          firstName: row.actor_first_name ?? '',
          lastName: row.actor_last_name ?? '',
        }
      : null,
    title: row.title,
    body: row.body,
    read: Boolean(row.read_at),
    createdAt: row.created_at,
    metadata: meta,
  };
}
