-- Undo feature: soft-delete + recovery window for the records clients most
-- often delete by mistake, plus field-level revert history for staff-managed
-- config (org settings, licence_config). Survey tables (pulse_link_invites,
-- pulse_link_responses) are deliberately untouched by this migration and by
-- every part of the undo feature — real respondent data must never be
-- reverted or purged by this mechanism.

-- 1) Soft-delete columns, mirroring pulse_sessions.deleted_at
--    (058_pulse_sessions_soft_delete.sql). purge_after drives a grace-period
--    hard-delete sweep, same shape as licence_config.scheduled_offboard_at.

ALTER TABLE client_work_tasks
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_client_work_tasks_org_deleted
  ON client_work_tasks (organization_id, deleted_at);

ALTER TABLE client_project_milestones
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_client_project_milestones_project_deleted
  ON client_project_milestones (project_id, deleted_at);

ALTER TABLE client_project_files
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_client_project_files_project_deleted
  ON client_project_files (project_id, deleted_at);

ALTER TABLE crm_contacts
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_crm_contacts_platform_org_deleted
  ON crm_contacts (platform_org_id, deleted_at);

-- 2) Field-level revert history. Separate from audit_events on purpose:
--    audit_events is immutable (trigger-enforced, 032_privacy_controls.sql),
--    but revert bookkeeping needs a mutable "already reverted" stamp, which
--    an append-only table structurally can't hold.

CREATE TABLE IF NOT EXISTS entity_field_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('organization', 'licence_config')),
  entity_id       UUID NOT NULL,
  field_name      TEXT NOT NULL,
  old_value       JSONB,
  new_value       JSONB,
  changed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  audit_event_id  UUID REFERENCES audit_events(id) ON DELETE SET NULL,
  reverted_at     TIMESTAMPTZ,
  reverted_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  revert_of_id    UUID REFERENCES entity_field_history(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_entity_field_history_lookup
  ON entity_field_history (organization_id, entity_type, entity_id, field_name, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_entity_field_history_org_reverted
  ON entity_field_history (organization_id, reverted_at);
