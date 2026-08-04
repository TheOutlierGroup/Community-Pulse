import { query } from '../config/database.js';
import { businessUnitsForEnabledServices, enabledServicesFromOrganizationSettings } from '../services/clientServices.js';
import { undoPurgeAfter } from '../services/undoConfig.js';

// A contact's relationship status is its own field, independent of whatever
// Prospect/Client it's linked to (see migration 074) — same vocabulary as
// crm_organisations/organizations for a consistent badge set.
const RELATIONSHIP_STATUSES = new Set(['warm', 'cold', 'lost', 'new']);

function normalizeContactRelationshipStatus(value) {
  return RELATIONSHIP_STATUSES.has(value) ? value : 'new';
}

// Core fields a human can set by hand. When they do, the field is recorded in
// crm_contacts.protected_fields so a later CSV import never overwrites it
// (see migration 078 / services/contactImport.js).
const PROTECTABLE_FIELDS = ['contact_firstname', 'contact_lastname', 'contact_email', 'contact_phone', 'contact_role', 'relationship_status'];

function providedProtectedFields(data) {
  return PROTECTABLE_FIELDS.filter((f) => f in data && String(data[f] ?? '').trim() !== '');
}

// SQL fragment that merges freshly-set field names into protected_fields,
// de-duplicated. Pushes one param (the text[] of new field names).
function pushProtectedMerge(sets, values, index, newlyProtected) {
  sets.push(`protected_fields = (SELECT ARRAY(SELECT DISTINCT e FROM unnest(protected_fields || $${index}::text[]) AS e))`);
  values.push(newlyProtected);
}

// ── Prospect-scoped (existing behaviour, column renamed under the hood) ────

export async function listContacts(organisationId) {
  const { rows } = await query(
    `SELECT * FROM crm_contacts WHERE crm_organisation_id = $1 AND deleted_at IS NULL ORDER BY created_date ASC, contact_id ASC`,
    [organisationId],
  );
  return rows;
}

export async function getContact(contactId, organisationId) {
  const { rows } = await query(
    `SELECT * FROM crm_contacts WHERE contact_id = $1 AND crm_organisation_id = $2 AND deleted_at IS NULL`,
    [contactId, organisationId],
  );
  return rows[0] || null;
}

export async function createContact(organisationId, data, platformOrgId, createdBy = null) {
  const { contact_firstname, contact_lastname, contact_email, contact_phone, contact_role, relationship_status } = data;
  const { rows } = await query(
    `INSERT INTO crm_contacts
       (contact_firstname, contact_lastname, contact_email, contact_phone, contact_role, relationship_status, crm_organisation_id, platform_org_id, created_by, protected_fields)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      contact_firstname, contact_lastname || null, contact_email || null, contact_phone || null, contact_role || null,
      normalizeContactRelationshipStatus(relationship_status),
      organisationId, platformOrgId, createdBy,
      providedProtectedFields(data),
    ],
  );
  // touch parent updated_at
  await query(`UPDATE crm_organisations SET updated_at = NOW() WHERE organisation_id = $1`, [organisationId]);
  return rows[0];
}

export async function updateContact(contactId, organisationId, data) {
  const allowed = ['contact_firstname', 'contact_lastname', 'contact_email', 'contact_phone', 'contact_role', 'relationship_status'];
  const sets = [];
  const values = [];
  let i = 1;

  for (const key of allowed) {
    if (key in data) {
      sets.push(`${key} = $${i++}`);
      values.push(key === 'relationship_status' ? normalizeContactRelationshipStatus(data[key]) : data[key] ?? null);
    }
  }
  if (sets.length === 0) return getContact(contactId, organisationId);

  const newlyProtected = providedProtectedFields(data);
  if (newlyProtected.length) pushProtectedMerge(sets, values, i++, newlyProtected);

  sets.push(`updated_at = NOW()`);
  values.push(contactId, organisationId);

  const { rows } = await query(
    `UPDATE crm_contacts SET ${sets.join(', ')}
      WHERE contact_id = $${i++} AND crm_organisation_id = $${i++}
      RETURNING *`,
    values,
  );
  await query(`UPDATE crm_organisations SET updated_at = NOW() WHERE organisation_id = $1`, [organisationId]);
  return rows[0] || null;
}

export async function deleteContact(contactId, organisationId, deletedByUserId = null) {
  const { rows } = await query(
    `UPDATE crm_contacts
     SET deleted_at = NOW(), deleted_by = $3, purge_after = $4
     WHERE contact_id = $1 AND crm_organisation_id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [contactId, organisationId, deletedByUserId, undoPurgeAfter()],
  );
  if (rows[0]) {
    await query(`UPDATE crm_organisations SET updated_at = NOW() WHERE organisation_id = $1`, [organisationId]);
  }
  return rows[0] || null;
}

export async function contactBelongsToOrg(organisationId, contactId) {
  const { rows } = await query(
    `SELECT 1 FROM crm_contacts WHERE contact_id = $1 AND crm_organisation_id = $2 AND deleted_at IS NULL`,
    [contactId, organisationId],
  );
  return rows.length > 0;
}

// ── Client-scoped ────────────────────────────────────────────────────────

export async function listContactsForClient(clientOrganizationId) {
  const { rows } = await query(
    `SELECT * FROM crm_contacts WHERE client_organization_id = $1 AND deleted_at IS NULL ORDER BY created_date ASC, contact_id ASC`,
    [clientOrganizationId],
  );
  return rows;
}

export async function getContactForClient(contactId, clientOrganizationId) {
  const { rows } = await query(
    `SELECT * FROM crm_contacts WHERE contact_id = $1 AND client_organization_id = $2 AND deleted_at IS NULL`,
    [contactId, clientOrganizationId],
  );
  return rows[0] || null;
}

export async function createContactForClient(clientOrganizationId, data, platformOrgId, createdBy = null) {
  const { contact_firstname, contact_lastname, contact_email, contact_phone, contact_role, relationship_status } = data;
  const { rows } = await query(
    `INSERT INTO crm_contacts
       (contact_firstname, contact_lastname, contact_email, contact_phone, contact_role, relationship_status, client_organization_id, platform_org_id, created_by, protected_fields)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      contact_firstname, contact_lastname || null, contact_email || null, contact_phone || null, contact_role || null,
      normalizeContactRelationshipStatus(relationship_status),
      clientOrganizationId, platformOrgId, createdBy,
      providedProtectedFields(data),
    ],
  );
  return rows[0];
}

export async function updateContactForClient(contactId, clientOrganizationId, data) {
  const allowed = ['contact_firstname', 'contact_lastname', 'contact_email', 'contact_phone', 'contact_role', 'relationship_status'];
  const sets = [];
  const values = [];
  let i = 1;

  for (const key of allowed) {
    if (key in data) {
      sets.push(`${key} = $${i++}`);
      values.push(key === 'relationship_status' ? normalizeContactRelationshipStatus(data[key]) : data[key] ?? null);
    }
  }
  if (sets.length === 0) return getContactForClient(contactId, clientOrganizationId);

  const newlyProtected = providedProtectedFields(data);
  if (newlyProtected.length) pushProtectedMerge(sets, values, i++, newlyProtected);

  sets.push(`updated_at = NOW()`);
  values.push(contactId, clientOrganizationId);

  const { rows } = await query(
    `UPDATE crm_contacts SET ${sets.join(', ')}
      WHERE contact_id = $${i++} AND client_organization_id = $${i++}
      RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function deleteContactForClient(contactId, clientOrganizationId, deletedByUserId = null) {
  const { rows } = await query(
    `UPDATE crm_contacts
     SET deleted_at = NOW(), deleted_by = $3, purge_after = $4
     WHERE contact_id = $1 AND client_organization_id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [contactId, clientOrganizationId, deletedByUserId, undoPurgeAfter()],
  );
  return rows[0] || null;
}

export async function restoreContactForClient(contactId, clientOrganizationId) {
  const { rows } = await query(
    `UPDATE crm_contacts
     SET deleted_at = NULL, deleted_by = NULL, purge_after = NULL
     WHERE contact_id = $1 AND client_organization_id = $2 AND deleted_at IS NOT NULL
     RETURNING *`,
    [contactId, clientOrganizationId],
  );
  return rows[0] || null;
}

export async function listDeletedContactsForClient(clientOrganizationId) {
  const { rows } = await query(
    `SELECT * FROM crm_contacts
     WHERE client_organization_id = $1 AND deleted_at IS NOT NULL
     ORDER BY deleted_at DESC`,
    [clientOrganizationId],
  );
  return rows;
}

export async function contactBelongsToClientOrg(clientOrganizationId, contactId) {
  const { rows } = await query(
    `SELECT 1 FROM crm_contacts WHERE contact_id = $1 AND client_organization_id = $2 AND deleted_at IS NULL`,
    [contactId, clientOrganizationId],
  );
  return rows.length > 0;
}

// ── Global (Platform Contacts page) ─────────────────────────────────────
// Every contact — prospect-linked, client-linked, both, or standalone —
// scoped to the workspace (platform_org_id) rather than any one org, so
// contacts survive their linked Prospect/Client being deleted.

// D-015: whether a contact falls inside a Basic-tier user's tagged
// Business Units, mirroring the same rule used for Clients (crmOrgRoutes.js
// via resolveBasicTierBusinessUnitScope): visible if its linked Prospect's
// own business_unit tag is allowed, or if its linked Client has an enabled
// service that maps into an allowed unit (organizationVisibleToBusinessUnits's
// mapping, applied here directly since a contact can link to either kind of
// org). A contact linked to neither isn't tied to any org's confidential
// data, so it's visible regardless of scope -- same as an admin/platform
// caller (allowedBusinessUnits === null) always is.
export function contactVisibleToBusinessUnits(context, allowedBusinessUnits) {
  if (!Array.isArray(allowedBusinessUnits)) return true;
  if (!context) return false;
  if (allowedBusinessUnits.length === 0) return false;
  const allowed = new Set(allowedBusinessUnits);
  if (!context.crm_organisation_id && !context.client_organization_id) return true;
  if (context.crm_organisation_id && allowed.has(context.prospect_business_unit)) return true;
  if (context.client_organization_id) {
    const clientBUs = businessUnitsForEnabledServices(
      enabledServicesFromOrganizationSettings(context.client_settings)
    );
    if (clientBUs.some((bu) => allowed.has(bu))) return true;
  }
  return false;
}

/** Business-Unit context for a single contact, for the same scope check listAllContacts applies to its list. */
export async function getContactBusinessUnitContext(platformOrgId, contactId) {
  const { rows } = await query(
    `SELECT c.crm_organisation_id, c.client_organization_id,
            po.business_unit AS prospect_business_unit,
            co.settings AS client_settings
       FROM crm_contacts c
       LEFT JOIN crm_organisations po ON po.organisation_id = c.crm_organisation_id
       LEFT JOIN organizations co ON co.id = c.client_organization_id
      WHERE c.contact_id = $1 AND c.platform_org_id = $2 AND c.deleted_at IS NULL`,
    [contactId, platformOrgId],
  );
  return rows[0] || null;
}

export async function listAllContacts(platformOrgId, { search, linkType, businessUnit, allowedBusinessUnits = null } = {}) {
  const conditions = ['c.platform_org_id = $1', 'c.deleted_at IS NULL'];
  const values = [platformOrgId];
  let i = 2;

  if (search) {
    conditions.push(
      `(c.contact_firstname ILIKE $${i} OR c.contact_lastname ILIKE $${i} OR c.contact_email ILIKE $${i} OR c.contact_role ILIKE $${i})`
    );
    values.push(`%${search}%`);
    i++;
  }
  if (linkType === 'prospect') {
    conditions.push('c.crm_organisation_id IS NOT NULL');
  } else if (linkType === 'client') {
    conditions.push('c.client_organization_id IS NOT NULL');
  } else if (linkType === 'unlinked') {
    conditions.push('c.crm_organisation_id IS NULL AND c.client_organization_id IS NULL');
  }
  if (businessUnit) {
    conditions.push(`po.business_unit = $${i++}`);
    values.push(businessUnit);
  }

  const { rows } = await query(
    `SELECT c.*,
            po.organisation_name AS prospect_name,
            po.business_unit AS prospect_business_unit,
            po.relationship_status AS prospect_relationship_status,
            co.name AS client_name,
            co.relationship_status AS client_relationship_status,
            co.settings AS client_settings
       FROM crm_contacts c
       LEFT JOIN crm_organisations po ON po.organisation_id = c.crm_organisation_id
       LEFT JOIN organizations co ON co.id = c.client_organization_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY c.updated_at DESC
      LIMIT 1000`,
    values,
  );
  // Clients don't have a first-class business_unit column like Prospects —
  // derive a display-only one from their enabled service catalog (same
  // mapping used to scope Basic-tier platform users to Business Units), so
  // the "linked to" badge can still carry a BU accent colour. Not used for
  // filtering; the businessUnit query param only matches Prospects.
  const withDerivedBu = rows.map((row) => ({
    ...row,
    client_business_unit: row.client_settings
      ? businessUnitsForEnabledServices(enabledServicesFromOrganizationSettings(row.client_settings))[0] || null
      : null,
  }));
  const scoped = Array.isArray(allowedBusinessUnits)
    ? withDerivedBu.filter((row) => contactVisibleToBusinessUnits(row, allowedBusinessUnits))
    : withDerivedBu;
  return scoped.map(({ client_settings, ...row }) => row);
}

export async function getContactGlobal(platformOrgId, contactId) {
  const { rows } = await query(
    `SELECT * FROM crm_contacts WHERE contact_id = $1 AND platform_org_id = $2 AND deleted_at IS NULL`,
    [contactId, platformOrgId],
  );
  return rows[0] || null;
}

export async function createContactGlobal(platformOrgId, data, createdBy = null) {
  const { contact_firstname, contact_lastname, contact_email, contact_phone, contact_role, relationship_status, crm_organisation_id, client_organization_id } = data;
  const { rows } = await query(
    `INSERT INTO crm_contacts
       (contact_firstname, contact_lastname, contact_email, contact_phone, contact_role, relationship_status, crm_organisation_id, client_organization_id, platform_org_id, created_by, protected_fields)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      contact_firstname, contact_lastname || null, contact_email || null, contact_phone || null, contact_role || null,
      normalizeContactRelationshipStatus(relationship_status),
      crm_organisation_id || null, client_organization_id || null, platformOrgId, createdBy,
      providedProtectedFields(data),
    ],
  );
  return rows[0];
}

export async function updateContactGlobal(platformOrgId, contactId, data) {
  const allowed = ['contact_firstname', 'contact_lastname', 'contact_email', 'contact_phone', 'contact_role', 'relationship_status'];
  const sets = [];
  const values = [];
  let i = 1;

  for (const key of allowed) {
    if (key in data) {
      sets.push(`${key} = $${i++}`);
      values.push(key === 'relationship_status' ? normalizeContactRelationshipStatus(data[key]) : data[key] ?? null);
    }
  }
  // Links are nullable and explicitly settable to null to "unlink" a
  // contact from a prospect/client — kept separate from the scalar-field
  // loop above since `undefined` must mean "leave as-is" but `null` must
  // mean "clear the link".
  if ('crm_organisation_id' in data) {
    sets.push(`crm_organisation_id = $${i++}`);
    values.push(data.crm_organisation_id || null);
  }
  if ('client_organization_id' in data) {
    sets.push(`client_organization_id = $${i++}`);
    values.push(data.client_organization_id || null);
  }

  if (sets.length === 0) return getContactGlobal(platformOrgId, contactId);

  const newlyProtected = providedProtectedFields(data);
  if (newlyProtected.length) pushProtectedMerge(sets, values, i++, newlyProtected);

  sets.push('updated_at = NOW()');
  values.push(contactId, platformOrgId);

  const { rows } = await query(
    `UPDATE crm_contacts SET ${sets.join(', ')}
      WHERE contact_id = $${i++} AND platform_org_id = $${i++}
      RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function deleteContactGlobal(platformOrgId, contactId, deletedByUserId = null) {
  const { rows } = await query(
    `UPDATE crm_contacts
     SET deleted_at = NOW(), deleted_by = $3, purge_after = $4
     WHERE contact_id = $1 AND platform_org_id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [contactId, platformOrgId, deletedByUserId, undoPurgeAfter()],
  );
  return rows[0] || null;
}

export async function restoreContactGlobal(platformOrgId, contactId) {
  const { rows } = await query(
    `UPDATE crm_contacts
     SET deleted_at = NULL, deleted_by = NULL, purge_after = NULL
     WHERE contact_id = $1 AND platform_org_id = $2 AND deleted_at IS NOT NULL
     RETURNING *`,
    [contactId, platformOrgId],
  );
  return rows[0] || null;
}

export async function listDeletedContactsGlobal(platformOrgId) {
  const { rows } = await query(
    `SELECT * FROM crm_contacts
     WHERE platform_org_id = $1 AND deleted_at IS NOT NULL
     ORDER BY deleted_at DESC`,
    [platformOrgId],
  );
  return rows;
}

// ── Purge sweep (backend/src/services/undoPurge.js) ────────────────────────

export async function findContactsDueForPurge(now = new Date()) {
  const { rows } = await query(
    `SELECT contact_id, platform_org_id, client_organization_id, contact_firstname, contact_lastname
     FROM crm_contacts
     WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL AND purge_after <= $1`,
    [now.toISOString()],
  );
  return rows;
}

export async function hardDeleteContact(contactId) {
  const { rowCount } = await query(`DELETE FROM crm_contacts WHERE contact_id = $1`, [contactId]);
  return rowCount > 0;
}
