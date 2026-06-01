-- CRM: organisations, contacts, notes
-- Replaces the earlier accounts/contacts model for the simplified CRM MVP.

CREATE TABLE crm_organisations (
    organisation_id     SERIAL PRIMARY KEY,
    organisation_name   TEXT NOT NULL,
    industry            TEXT,
    website             TEXT,
    phone               TEXT,
    business_unit       TEXT NOT NULL DEFAULT 'Outlier Core'
                        CHECK (business_unit IN (
                            'Outlier Core',
                            'Outlier Skate',
                            'Rhythm Engine',
                            'Adoption Accelerator',
                            'AI-Human Workforce Design',
                            'ET Inc'
                        )),
    lead_status         TEXT NOT NULL DEFAULT 'New',
    lead_source         TEXT,
    created_date        DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_close_date DATE,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    platform_org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX idx_crm_orgs_platform_org ON crm_organisations(platform_org_id);

CREATE TABLE crm_contacts (
    contact_id          SERIAL PRIMARY KEY,
    contact_firstname   TEXT NOT NULL,
    contact_lastname    TEXT,
    contact_email       TEXT,
    contact_phone       TEXT,
    contact_role        TEXT,
    organisation_id     INTEGER NOT NULL REFERENCES crm_organisations(organisation_id) ON DELETE CASCADE,
    created_date        DATE NOT NULL DEFAULT CURRENT_DATE,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crm_contacts_org ON crm_contacts(organisation_id);

CREATE TABLE crm_notes (
    note_id             SERIAL PRIMARY KEY,
    note_text           TEXT NOT NULL,
    note_date           DATE NOT NULL DEFAULT CURRENT_DATE,
    contact_id          INTEGER REFERENCES crm_contacts(contact_id) ON DELETE CASCADE,
    organisation_id     INTEGER REFERENCES crm_organisations(organisation_id) ON DELETE CASCADE,
    created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT crm_note_single_target CHECK (
        (contact_id IS NOT NULL)::int + (organisation_id IS NOT NULL)::int = 1
    )
);

CREATE INDEX idx_crm_notes_org     ON crm_notes(organisation_id);
CREATE INDEX idx_crm_notes_contact ON crm_notes(contact_id);
