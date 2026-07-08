-- Lightweight task board for CRM prospects (crm_organisations), separate
-- from client_work_tasks which is hard-wired to organizations(id) (UUID).
-- Prospects use an integer PK in a different table entirely, and don't have
-- their own users to assign to, so this intentionally stays a simpler board
-- (no comments/checklist/images/labels) rather than retrofitting the client
-- task system to be polymorphic.

CREATE TABLE IF NOT EXISTS crm_organisation_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id INTEGER NOT NULL REFERENCES crm_organisations(organisation_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'working', 'review', 'completed')),
  position INTEGER NOT NULL DEFAULT 0,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  due_date DATE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_organisation_tasks_org ON crm_organisation_tasks(organisation_id);
CREATE INDEX IF NOT EXISTS idx_crm_organisation_tasks_assigned ON crm_organisation_tasks(assigned_to);
