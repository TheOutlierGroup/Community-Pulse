-- Phase 3b: Link existing task board to projects
--
-- Adds an optional project_id foreign key to client_work_tasks so that
-- tasks created within the delivery phase are associated with a project.
-- Existing org-scoped tasks (pre-conversion) keep project_id = NULL and
-- continue to work exactly as before — no data migration required.

ALTER TABLE client_work_tasks
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_client_work_tasks_project
  ON client_work_tasks (project_id) WHERE project_id IS NOT NULL;
