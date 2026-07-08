import { query } from '../config/database.js';

export const BUSINESS_UNITS = [
  'Outlier Core',
  'Outlier Skate',
  'Rhythm Engine',
  'Adoption Accelerator',
  'AI-Human Workforce Design',
  'ET Inc',
];

export const LEAD_STATUSES = ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost', 'On Hold'];

export async function listOrganisations(platformOrgId, { search, businessUnit, leadStatus, includePromoted = false, limit = 100, offset = 0 } = {}) {
  const conditions = ['o.platform_org_id = $1'];
  const values = [platformOrgId];
  let i = 2;

  if (!includePromoted) {
    conditions.push('o.promoted_to_org_id IS NULL');
  }
  if (search) {
    conditions.push(`o.organisation_name ILIKE $${i++}`);
    values.push(`%${search}%`);
  }
  if (businessUnit) {
    conditions.push(`o.business_unit = $${i++}`);
    values.push(businessUnit);
  }
  if (leadStatus) {
    conditions.push(`o.lead_status = $${i++}`);
    values.push(leadStatus);
  }

  const { rows } = await query(
    `SELECT o.*,
            COUNT(c.contact_id) AS contact_count
       FROM crm_organisations o
       LEFT JOIN crm_contacts c ON c.organisation_id = o.organisation_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY o.organisation_id
      ORDER BY o.updated_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...values, limit, offset],
  );
  return rows;
}

export async function getOrganisation(platformOrgId, organisationId) {
  const { rows } = await query(
    `SELECT * FROM crm_organisations WHERE organisation_id = $1 AND platform_org_id = $2`,
    [organisationId, platformOrgId],
  );
  return rows[0] || null;
}

export async function createOrganisation(platformOrgId, data) {
  const { organisation_name, industry, website, phone, business_unit, lead_status, lead_source, expected_close_date } = data;
  const { rows } = await query(
    `INSERT INTO crm_organisations
       (organisation_name, industry, website, phone, business_unit, lead_status, lead_source, expected_close_date, platform_org_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      organisation_name,
      industry || null,
      website || null,
      phone || null,
      business_unit || 'Outlier Core',
      lead_status || 'New',
      lead_source || null,
      expected_close_date || null,
      platformOrgId,
    ],
  );
  return rows[0];
}

export async function updateOrganisation(platformOrgId, organisationId, data) {
  const allowed = ['organisation_name', 'industry', 'website', 'phone', 'business_unit', 'lead_status', 'lead_source', 'expected_close_date', 'do_not_contact'];
  const sets = [];
  const values = [];
  let i = 1;

  for (const key of allowed) {
    if (key in data) {
      sets.push(`${key} = $${i++}`);
      // expected_close_date is a DATE column; Postgres rejects '' (only
      // accepts a valid date or NULL), so an empty string must map to null.
      const value = key === 'expected_close_date' && data[key] === '' ? null
        : key === 'do_not_contact' ? Boolean(data[key])
        : data[key];
      values.push(value ?? null);
    }
  }
  if (sets.length === 0) return getOrganisation(platformOrgId, organisationId);

  sets.push(`updated_at = NOW()`);
  values.push(organisationId, platformOrgId);

  const { rows } = await query(
    `UPDATE crm_organisations SET ${sets.join(', ')}
      WHERE organisation_id = $${i++} AND platform_org_id = $${i++}
      RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function deleteOrganisation(platformOrgId, organisationId) {
  await query(
    `DELETE FROM crm_organisations WHERE organisation_id = $1 AND platform_org_id = $2`,
    [organisationId, platformOrgId],
  );
}

export async function organisationBelongsToOrg(platformOrgId, organisationId) {
  const { rows } = await query(
    `SELECT 1 FROM crm_organisations WHERE organisation_id = $1 AND platform_org_id = $2`,
    [organisationId, platformOrgId],
  );
  return rows.length > 0;
}

export async function setLogoFilename(platformOrgId, organisationId, filename) {
  const { rows } = await query(
    `UPDATE crm_organisations SET logo_filename = $1, updated_at = NOW()
      WHERE organisation_id = $2 AND platform_org_id = $3
      RETURNING *`,
    [filename, organisationId, platformOrgId],
  );
  return rows[0] || null;
}

export async function clearLogoFilename(platformOrgId, organisationId) {
  const org = await getOrganisation(platformOrgId, organisationId);
  const prev = org?.logo_filename || null;
  await query(
    `UPDATE crm_organisations SET logo_filename = NULL, updated_at = NOW()
      WHERE organisation_id = $1 AND platform_org_id = $2`,
    [organisationId, platformOrgId],
  );
  return prev;
}

export async function markPromoted(platformOrgId, organisationId, clientOrgId) {
  const { rows } = await query(
    `UPDATE crm_organisations
        SET promoted_to_org_id = $1, promoted_at = NOW(), updated_at = NOW()
      WHERE organisation_id = $2 AND platform_org_id = $3
      RETURNING *`,
    [clientOrgId, organisationId, platformOrgId],
  );
  return rows[0] || null;
}
