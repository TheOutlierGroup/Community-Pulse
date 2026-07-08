-- Rename the 'Human AI' service to 'AI-Human Workforce Design' and add an
-- 'ET Inc' service inside any platform organization's persisted custom
-- service catalog (organizations.settings->'serviceCatalog'), so the
-- rename/addition takes effect even where an admin already customized the
-- catalog via Platform Settings instead of relying on the code-level
-- defaults in clientServices.js.

DO $$
DECLARE
  org RECORD;
  renamed jsonb;
  updated jsonb;
  has_et_inc boolean;
BEGIN
  FOR org IN
    SELECT id, settings FROM organizations
     WHERE kind = 'platform' AND jsonb_typeof(settings->'serviceCatalog') = 'array'
  LOOP
    SELECT COALESCE(jsonb_agg(
             CASE WHEN elem->>'id' = 'human-ai'
                  THEN jsonb_set(elem, '{name}', '"AI-Human Workforce Design"')
                  ELSE elem
             END
           ), '[]'::jsonb)
      INTO renamed
      FROM jsonb_array_elements(org.settings->'serviceCatalog') AS elem;

    has_et_inc := EXISTS (
      SELECT 1 FROM jsonb_array_elements(renamed) AS elem WHERE elem->>'id' = 'et-inc'
    );
    IF has_et_inc THEN
      updated := renamed;
    ELSE
      updated := renamed || jsonb_build_array(jsonb_build_object('id', 'et-inc', 'name', 'ET Inc'));
    END IF;

    UPDATE organizations
       SET settings = jsonb_set(settings, '{serviceCatalog}', updated)
     WHERE id = org.id;
  END LOOP;
END $$;
