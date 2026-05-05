-- INF-06: per-licensee branding metadata. The actual logo image is the
-- licensee organization's existing company_logo_filename (avoids a second
-- upload pipeline); these columns hold the display name licensees want
-- their downstream clients to see and the brand colour used as an accent
-- in UI / emails. brand_use_for_downstream defaults TRUE so the
-- white-label flow ("downstream client surveys carry the licensee brand,
-- not Outlier") works as soon as a licensee fills these in.

ALTER TABLE licence_config
  ADD COLUMN IF NOT EXISTS brand_display_name TEXT;

ALTER TABLE licence_config
  ADD COLUMN IF NOT EXISTS brand_primary_color TEXT;

ALTER TABLE licence_config
  ADD COLUMN IF NOT EXISTS brand_use_for_downstream BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE licence_config
  DROP CONSTRAINT IF EXISTS licence_config_brand_color_format;

ALTER TABLE licence_config
  ADD CONSTRAINT licence_config_brand_color_format
  CHECK (
    brand_primary_color IS NULL
    OR brand_primary_color ~* '^#[0-9a-f]{6}$'
  );
