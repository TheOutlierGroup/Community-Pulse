-- Support pulse alert in-app notifications.
-- task_id is made nullable because pulse alerts have no associated task.
-- pulse_alert added to the type enum.

ALTER TABLE in_app_notifications
  ALTER COLUMN task_id DROP NOT NULL;

ALTER TABLE in_app_notifications
  DROP CONSTRAINT in_app_notifications_type_check;

ALTER TABLE in_app_notifications
  ADD CONSTRAINT in_app_notifications_type_check
  CHECK (type IN (
    'comment_mention',
    'task_assigned',
    'task_watched_comment',
    'task_watched_update',
    'pulse_alert'
  ));
