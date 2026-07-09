import { query } from '../config/database.js';

// ── Prospect-scoped (existing behaviour, column renamed under the hood) ────

export async function listContacts(organisationId) {
  const { rows } = await query(
    `SELECT * FROM crm_contacts WHERE crm_organisation_id = $1 ORDER BY created_date ASC, contact_id ASC`,
    [organisationId],
  );
  return rows;
}

export async function getContact(contactId, organisationId) {
  const { rows } = await query(
    `SELECT * FROM crm_contacts WHERE contact_id = $1 AND crm_organisation_id = $2`,
    [contactId, organisationId],
  );
  return rows[0] || null;
}

export async function createContact(organisationId, data, platformOrgId, createdBy = null) {
  const { contact_firstname, contact_lastname, contact_email, contact_phone, contact_role } = data;
  const { rows } = await query(
    `INSERT INTO crm_contacts
       (contact_firstname, contact_lastname, contact_email, contact_phone, contact_role, crm_organisation_id, platform_org_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      contact_firstname, contact_lastname || null, contact_email || null, contact_phone || null, contact_role || null,
      organisationId, platformOrgId, createdBy,
    ],
  );
  // touch parent updated_at
  await query(`UPDATE crm_organisations SET updated_at = NOW() WHERE organisation_id = $1`, [organisationId]);
  return rows[0];
}

export async function updateContact(contactId, organisationId, data) {
  const allowed = ['contact_firstname', 'contact_lastname', 'contact_email', 'contact_phone', 'contact_role'];
  const sets = [];
  const values = [];
  let i = 1;

  for (const key of allowed) {
    if (key in data) {
      sets.push(`${key} = $${i++}`);
      values.push(data[key] ?? null);
    }
  }
  if (sets.length === 0) return getContact(contactId, organisationId);

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

export async function deleteContact(contactId, organisationId) {
  await query(
    `DELETE FROM crm_contacts WHERE contact_id = $1 AND crm_organisation_id = $2`,
    [contactId, organisationId],
  );
  await query(`UPDATE crm_organisations SET updated_at = NOW() WHERE organisation_id = $1`, [organisationId]);
}

export async function contactBelongsToOrg(organisationId, contactId) {
  const { rows } = await query(
    `SELECT 1 FROM crm_contacts WHERE contact_id = $1 AND crm_organisation_id = $2`,
    [contactId, organisationId],
  );
  return rows.length > 0;
}

// ── Client-scoped ────────────────────────────────────────────────────────

export async function listContactsForClient(clientOrganizationId) {
  const { rows } = await query(
    `SELECT * FROM crm_contacts WHERE client_organization_id = $1 ORDER BY created_date ASC, contact_id ASC`,
    [clientOrganizationId],
  );
  return rows;
}

export async function getContactForClient(contactId, clientOrganizationId) {
  const { rows } = await query(
    `SELECT * FROM crm_contacts WHERE contact_id = $1 AND client_organization_id = $2`,
    [contactId, clientOrganizationId],
  );
  return rows[0] || null;
}

export async function createContactForClient(clientOrganizationId, data, platformOrgId, createdBy = null) {
  const { contact_firstname, contact_lastname, contact_email, contact_phone, contact_role } = data;
  const { rows } = await query(
    `INSERT INTO crm_contacts
       (contact_firstname, contact_lastname, contact_email, contact_phone, contact_role, client_organization_id, platform_org_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      contact_firstname, contact_lastname || null, contact_email || null, contact_phone || null, contact_role || null,
      clientOrganizationId, platformOrgId, createdBy,
    ],
  );
  return rows[0];
}

export async function updateContactForClient(contactId, clientOrganizationId, data) {
  const allowed = ['contact_firstname', 'contact_lastname', 'contact_email', 'contact_phone', 'contact_role'];
  const sets = [];
  const values = [];
  let i = 1;

  for (const key of allowed) {
    if (key in data) {
      sets.push(`${key} = $${i++}`);
      values.push(data[key] ?? null);
    }
  }
  if (sets.length === 0) return getContactForClient(contactId, clientOrganizationId);

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

export async function deleteContactForClient(contactId, clientOrganizationId) {
  await query(
    `DELETE FROM crm_contacts WHERE contact_id = $1 AND client_organization_id = $2`,
    [contactId, clientOrganizationId],
  );
}

export async function contactBelongsToClientOrg(clientOrganizationId, contactId) {
  const { rows } = await query(
    `SELECT 1 FROM crm_contacts WHERE contact_id = $1 AND client_organization_id = $2`,
    [contactId, clientOrganizationId],
  );
  return rows.length > 0;
}

// ── Global (Platform Contacts page) ─────────────────────────────────────
// Every contact — prospect-linked, client-linked, both, or standalone —
// scoped to the workspace (platform_org_id) rather than any one org, so
// contacts survive their linked Prospect/Client being deleted.

export async function listAllContacts(platformOrgId, { search, linkType, businessUnit } = {}) {
  const conditions = ['c.platform_org_id = $1'];
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
            co.name AS client_name
       FROM crm_contacts c
       LEFT JOIN crm_organisations po ON po.organisation_id = c.crm_organisation_id
       LEFT JOIN organizations co ON co.id = c.client_organization_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY c.updated_at DESC
      LIMIT 1000`,
    values,
  );
  return rows;
}

export async function getContactGlobal(platformOrgId, contactId) {
  const { rows } = await query(
    `SELECT * FROM crm_contacts WHERE contact_id = $1 AND platform_org_id = $2`,
    [contactId, platformOrgId],
  );
  return rows[0] || null;
}

export async function createContactGlobal(platformOrgId, data, createdBy = null) {
  const { contact_firstname, contact_lastname, contact_email, contact_phone, contact_role, crm_organisation_id, client_organization_id } = data;
  const { rows } = await query(
    `INSERT INTO crm_contacts
       (contact_firstname, contact_lastname, contact_email, contact_phone, contact_role, crm_organisation_id, client_organization_id, platform_org_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      contact_firstname, contact_lastname || null, contact_email || null, contact_phone || null, contact_role || null,
      crm_organisation_id || null, client_organization_id || null, platformOrgId, createdBy,
    ],
  );
  return rows[0];
}

export async function updateContactGlobal(platformOrgId, contactId, data) {
  const allowed = ['contact_firstname', 'contact_lastname', 'contact_email', 'contact_phone', 'contact_role'];
  const sets = [];
  const values = [];
  let i = 1;

  for (const key of allowed) {
    if (key in data) {
      sets.push(`${key} = $${i++}`);
      values.push(data[key] ?? null);
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

export async function deleteContactGlobal(platformOrgId, contactId) {
  await query(
    `DELETE FROM crm_contacts WHERE contact_id = $1 AND platform_org_id = $2`,
    [contactId, platformOrgId],
  );
}
