-- Audit events are append-only / immutable (see prevent_audit_events_mutation
-- trigger in 032_privacy_controls.sql). The original FKs were declared
-- ON DELETE SET NULL, but the immutability trigger blocks the cascading
-- UPDATE that those references trigger when a referenced organization or
-- user is deleted. The result was a hard crash on org / user deletion:
--
--   error: audit_events are immutable
--   ... at deleteOrganization (Organization.js)
--
-- Audit logs should preserve the original IDs as historical values regardless
-- of whether the referenced row still exists, so the right fix is to drop
-- the FK constraints entirely. Indexes and columns stay; only enforced
-- referential integrity is removed.
ALTER TABLE audit_events
  DROP CONSTRAINT IF EXISTS audit_events_actor_user_id_fkey,
  DROP CONSTRAINT IF EXISTS audit_events_actor_organization_id_fkey,
  DROP CONSTRAINT IF EXISTS audit_events_target_organization_id_fkey;
