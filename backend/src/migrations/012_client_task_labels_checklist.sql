-- Card labels (free-text tags) and per-task checklist items

CREATE TABLE IF NOT EXISTS client_work_task_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES client_work_tasks(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_work_task_labels_name_len CHECK (char_length(btrim(name)) > 0 AND char_length(name) <= 80)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_work_task_labels_task_name_lower
  ON client_work_task_labels (task_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_client_work_task_labels_task ON client_work_task_labels(task_id);

CREATE TABLE IF NOT EXISTS client_work_task_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES client_work_tasks(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  done BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_work_task_checklist_body_len CHECK (char_length(body) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_client_work_task_checklist_task ON client_work_task_checklist_items(task_id);
