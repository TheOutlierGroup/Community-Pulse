ALTER TABLE pulse_link_invites
  ADD COLUMN IF NOT EXISTS timepoint_instance_key TEXT;

UPDATE pulse_link_invites
SET timepoint_instance_key = CASE
  WHEN timepoint_phase = 'pre' THEN 'pre'
  WHEN timepoint_phase = 'completed' THEN 'post'
  ELSE timepoint_instance_key
END
WHERE timepoint_phase IN ('pre', 'completed')
  AND (timepoint_instance_key IS NULL OR btrim(timepoint_instance_key) = '');

WITH org_during_session AS (
  SELECT
    org.id AS organization_id,
    COALESCE(
      (
        SELECT ps.id::text
        FROM pulse_sessions ps
        WHERE ps.organization_id = org.id
          AND ps.session_purpose = 'during_project'
          AND ps.audience = 'staff'
        ORDER BY
          CASE WHEN ps.status = 'active' THEN 0 ELSE 1 END,
          ps.created_at DESC
        LIMIT 1
      ),
      (
        SELECT ps.id::text
        FROM pulse_sessions ps
        WHERE ps.organization_id = org.id
          AND ps.session_purpose = 'during_project'
        ORDER BY
          CASE WHEN ps.status = 'active' THEN 0 ELSE 1 END,
          ps.created_at DESC
        LIMIT 1
      ),
      'legacy-mid'
    ) AS session_or_legacy
  FROM organizations org
)
UPDATE pulse_link_invites pli
SET timepoint_instance_key = CASE
  WHEN ods.session_or_legacy = 'legacy-mid' THEN 'legacy-mid'
  ELSE 'session:' || ods.session_or_legacy
END
FROM org_during_session ods
WHERE pli.organization_id = ods.organization_id
  AND pli.timepoint_phase = 'mid'
  AND (pli.timepoint_instance_key IS NULL OR btrim(pli.timepoint_instance_key) = '');

ALTER TABLE pulse_link_invites
  ALTER COLUMN timepoint_instance_key SET DEFAULT 'pre';

UPDATE pulse_link_invites
SET timepoint_instance_key = 'pre'
WHERE timepoint_instance_key IS NULL OR btrim(timepoint_instance_key) = '';

ALTER TABLE pulse_link_invites
  ALTER COLUMN timepoint_instance_key SET NOT NULL;

DROP INDEX IF EXISTS idx_pulse_link_invites_org_timepoint_email;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pulse_link_invites_org_timepoint_instance_email
  ON pulse_link_invites (organization_id, timepoint_phase, timepoint_instance_key, email);

CREATE INDEX IF NOT EXISTS idx_pulse_link_invites_org_timepoint_instance
  ON pulse_link_invites (organization_id, timepoint_phase, timepoint_instance_key);
