import { query } from '../config/database.js';
import * as InAppNotification from '../models/InAppNotification.js';
import * as ClientWorkTask from '../models/ClientWorkTask.js';

const TYPES = InAppNotification.NOTIFICATION_TYPES;

const STATUS_LABEL = {
  todo: 'To do',
  working: 'Working on',
  review: 'Review',
  completed: 'Completed',
};

async function displayName(userId) {
  if (!userId) return 'Someone';
  const { rows } = await query(`SELECT first_name, last_name, email FROM users WHERE id = $1`, [userId]);
  const r = rows[0];
  if (!r) return 'Someone';
  const n = [r.first_name, r.last_name].filter(Boolean).join(' ').trim();
  return n || r.email || 'Someone';
}

async function notifyNewComment({ organizationId, taskId, commentId, authorId, mentionUserIds, taskTitle }) {
  const author = await displayName(authorId);
  const mentions = [...new Set((mentionUserIds || []).map(String))].filter((id) => id && id !== String(authorId));

  for (const uid of mentions) {
    await InAppNotification.createNotification({
      userId: uid,
      organizationId,
      type: TYPES.COMMENT_MENTION,
      taskId,
      commentId,
      actorUserId: authorId,
      title: `${author} mentioned you in “${taskTitle}”`,
      body: null,
      metadata: {},
    });
  }

  const mentionSet = new Set(mentions);
  const watchers = await ClientWorkTask.listWatcherUserIdsForTask(taskId, organizationId);
  for (const wid of watchers) {
    if (wid === String(authorId)) continue;
    if (mentionSet.has(wid)) continue;
    await InAppNotification.createNotification({
      userId: wid,
      organizationId,
      type: TYPES.WATCHED_COMMENT,
      taskId,
      commentId,
      actorUserId: authorId,
      title: `${author} commented on “${taskTitle}”`,
      metadata: {},
    });
  }
}

export function scheduleNotifyNewComment(params) {
  void notifyNewComment(params).catch((e) => console.error('[scheduleNotifyNewComment]', e));
}

async function notifyTaskAssigned({ organizationId, taskId, assigneeId, actorId, taskTitle }) {
  if (!assigneeId || String(assigneeId) === String(actorId)) return;
  await InAppNotification.createNotification({
    userId: String(assigneeId),
    organizationId,
    type: TYPES.TASK_ASSIGNED,
    taskId,
    commentId: null,
    actorUserId: actorId,
    title: `You were assigned to “${taskTitle}”`,
    metadata: {},
  });
}

export function scheduleNotifyTaskAssigned(params) {
  void notifyTaskAssigned(params).catch((e) => console.error('[scheduleNotifyTaskAssigned]', e));
}

async function notifyTaskUpdatesForWatchers({ organizationId, taskId, actorId, beforeRow, afterRow, taskTitle }) {
  if (!beforeRow || !afterRow) return;
  const changes = [];
  if (beforeRow.title !== afterRow.title) changes.push('Title updated');
  if (beforeRow.body !== afterRow.body) changes.push('Description updated');
  if (beforeRow.status !== afterRow.status) {
    changes.push(`Status → ${STATUS_LABEL[afterRow.status] || afterRow.status}`);
  }
  if (beforeRow.start_date !== afterRow.start_date || beforeRow.due_date !== afterRow.due_date) {
    changes.push('Dates updated');
  }
  if (String(beforeRow.assignee_id || '') !== String(afterRow.assignee_id || '')) {
    changes.push('Assignee updated');
  }
  if (changes.length === 0) return;

  const actor = await displayName(actorId);
  const watchers = await ClientWorkTask.listWatcherUserIdsForTask(taskId, organizationId);
  const onlyAssigneeChange = changes.length === 1 && changes[0] === 'Assignee updated';
  const newAssigneeId = afterRow.assignee_id != null ? String(afterRow.assignee_id) : null;
  for (const wid of watchers) {
    if (wid === String(actorId)) continue;
    if (onlyAssigneeChange && newAssigneeId && wid === newAssigneeId) continue;
    await InAppNotification.createNotification({
      userId: wid,
      organizationId,
      type: TYPES.WATCHED_UPDATE,
      taskId,
      commentId: null,
      actorUserId: actorId,
      title: `${actor} updated “${taskTitle}”`,
      body: changes.join(' · '),
      metadata: { changes },
    });
  }
}

export function scheduleNotifyTaskUpdatesForWatchers(params) {
  void notifyTaskUpdatesForWatchers(params).catch((e) => console.error('[scheduleNotifyTaskUpdatesForWatchers]', e));
}
