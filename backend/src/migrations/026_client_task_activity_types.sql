ALTER TABLE client_work_task_activity
  DROP CONSTRAINT IF EXISTS client_work_task_activity_activity_type_check;

ALTER TABLE client_work_task_activity
  ADD CONSTRAINT client_work_task_activity_activity_type_check
  CHECK (
    activity_type IN (
      'created',
      'status_changed',
      'assignee_changed',
      'start_date_changed',
      'due_date_changed',
      'checklist_item_added',
      'checklist_item_removed'
    )
  );
