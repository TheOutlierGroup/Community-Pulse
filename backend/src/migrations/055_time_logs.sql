-- Phase 3c: Time & expense logs
--
-- Time logs are attached to a project and optionally to a specific task
-- within that project. They drive the "Actual Hours" and "Actual Cost"
-- metrics for Baseline vs. Actual budget tracking.
--
-- cost_rate: the hourly rate charged or cost recorded for this entry.
-- actual_cost for the entry = hours * cost_rate (computed at query time).

CREATE TABLE IF NOT EXISTS project_time_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id     UUID        REFERENCES client_work_tasks(id) ON DELETE SET NULL,
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,

  description TEXT,
  hours       NUMERIC(8,2) NOT NULL CHECK (hours > 0),
  cost_rate   NUMERIC(10,2),           -- optional; NULL = hours-only tracking
  logged_date DATE        NOT NULL DEFAULT CURRENT_DATE,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_time_logs_project
  ON project_time_logs (project_id);
CREATE INDEX IF NOT EXISTS idx_project_time_logs_task
  ON project_time_logs (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_time_logs_user
  ON project_time_logs (user_id);
