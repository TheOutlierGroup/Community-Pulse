-- CRM: allow a prospect organisation to have an uploaded company logo,
-- mirroring the existing client organizations.company_logo_filename field.

ALTER TABLE crm_organisations ADD COLUMN logo_filename TEXT;
