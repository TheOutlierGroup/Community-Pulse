-- Track manager ownership for pulse_link_invites staff recipients.

ALTER TABLE pulse_link_invites
  ADD COLUMN IF NOT EXISTS manager_invite_id UUID REFERENCES pulse_link_invites(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pulse_link_invites_org_manager
  ON pulse_link_invites (organization_id, manager_invite_id);
