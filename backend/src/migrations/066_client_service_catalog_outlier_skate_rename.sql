-- Rename "OG Skate" to "Outlier Skate" inside any platform organization's
-- persisted custom service catalog (organizations.settings->'serviceCatalog'),
-- mirroring migration 062's Human AI rename so this takes effect even where
-- an admin already customized the catalog via Platform Settings.

DO $$
DECLARE
  org RECORD;
  renamed jsonb;
BEGIN
  FOR org IN
    SELECT id, settings FROM organizations
     WHERE kind = 'platform' AND jsonb_typeof(settings->'serviceCatalog') = 'array'
  LOOP
    SELECT COALESCE(jsonb_agg(
             CASE WHEN elem->>'id' LIKE 'og-skate-%'
                  THEN jsonb_set(
                         elem,
                         '{name}',
                         to_jsonb(regexp_replace(elem->>'name', '^OG Skate', 'Outlier Skate'))
                       )
                  ELSE elem
             END
           ), '[]'::jsonb)
      INTO renamed
      FROM jsonb_array_elements(org.settings->'serviceCatalog') AS elem;

    UPDATE organizations
       SET settings = jsonb_set(settings, '{serviceCatalog}', renamed)
     WHERE id = org.id;
  END LOOP;
END $$;
