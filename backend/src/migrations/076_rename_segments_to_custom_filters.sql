-- Rename "segments" to "custom filters" throughout. The concept is a named,
-- saved filter over the contacts list; "custom filter" reads more plainly for
-- the Marketing/BDM team than "segment". Table, primary key and indexes are
-- renamed so the schema matches the product vocabulary (the scope CHECK and
-- pkey constraint names keep their auto-generated identifiers — functional,
-- just not renamed).
ALTER TABLE crm_segments RENAME TO crm_custom_filters;
ALTER TABLE crm_custom_filters RENAME COLUMN segment_id TO filter_id;

ALTER INDEX idx_crm_segments_platform_org RENAME TO idx_crm_custom_filters_platform_org;
ALTER INDEX idx_crm_segments_owner RENAME TO idx_crm_custom_filters_owner;
