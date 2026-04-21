-- Activity timeline for task cards (created, status changes, etc.)

CREATE TABLE IF NOT EXISTS client_work_task_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES client_work_tasks(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('created', 'status_changed')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_work_task_activity_task_created_at
  ON client_work_task_activity(task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_work_task_activity_org
  ON client_work_task_activity(organization_id);

INSERT INTO client_work_task_activity (task_id, organization_id, actor_id, activity_type, payload, created_at)
SELECT t.id, t.organization_id, t.created_by, 'created', '{}'::jsonb, t.created_at
FROM client_work_tasks t
WHERE NOT EXISTS (
  SELECT 1
  FROM client_work_task_activity a
  WHERE a.task_id = t.id
    AND a.activity_type = 'created'
);
