-- Kanban columns: todo, working, review, completed + per-column ordering

ALTER TABLE client_work_tasks ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

ALTER TABLE client_work_tasks DROP CONSTRAINT IF EXISTS client_work_tasks_status_check;

UPDATE client_work_tasks SET status = 'todo' WHERE status = 'open';
UPDATE client_work_tasks SET status = 'completed' WHERE status = 'done';

ALTER TABLE client_work_tasks ADD CONSTRAINT client_work_tasks_status_check
  CHECK (status IN ('todo', 'working', 'review', 'completed'));

ALTER TABLE client_work_tasks ALTER COLUMN status SET DEFAULT 'todo';

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY organization_id, status ORDER BY created_at ASC) - 1 AS pos
  FROM client_work_tasks
)
UPDATE client_work_tasks t SET position = ranked.pos FROM ranked WHERE t.id = ranked.id;
