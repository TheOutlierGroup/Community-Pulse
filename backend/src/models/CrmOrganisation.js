import { query } from '../config/database.js';
import { sanitizeCustomFields } from '../services/prospectCustomFields.js';

export const BUSINESS_UNITS = [
  'Outlier Core',
  'Outlier Skate',
  'Rhythm Engine',
  'Adoption Accelerator',
  'AI-Human Workforce Design',
  'ET Inc',
];

export const LEAD_STATUSES = ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost', 'On Hold'];

/**
 * @param allowedBusinessUnits - when set (a Basic-tier platform user's BU
 *   tags), restricts results to those units regardless of the businessUnit
 *   query filter. An empty array means "no tags yet" and must return zero
 *   rows, not all rows — the caller (route) should special-case that rather
 *   than call in with [].
 */
export async function listOrganisations(platformOrgId, { search, businessUnit, leadStatus, includePromoted = false, allowedBusinessUnits = null, limit = 100, offset = 0 } = {}) {
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
  if (Array.isArray(allowedBusinessUnits)) {
    conditions.push(`o.business_unit = ANY($${i++}::text[])`);
    values.push(allowedBusinessUnits);
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

const RELATIONSHIP_STATUSES = new Set(['warm', 'cold', 'lost', 'new', 'active-campaign']);

export async function updateOrganisation(platformOrgId, organisationId, data) {
  const allowed = [
    'organisation_name', 'industry', 'website', 'phone', 'business_unit', 'lead_status', 'lead_source',
    'expected_close_date', 'do_not_contact', 'relationship_status', 'owner_user_id', 'last_contact_at',
  ];
  const sets = [];
  const values = [];
  let i = 1;

  for (const key of allowed) {
    if (key in data) {
      sets.push(`${key} = $${i++}`);
      // expected_close_date/last_contact_at are DATE/TIMESTAMPTZ columns;
      // Postgres rejects '' for those (only a valid value or NULL), so an
      // empty string must map to null. Same for owner_user_id (a UUID FK).
      const value = (key === 'expected_close_date' || key === 'last_contact_at' || key === 'owner_user_id') && data[key] === '' ? null
        : key === 'do_not_contact' ? Boolean(data[key])
        : key === 'relationship_status' && !RELATIONSHIP_STATUSES.has(data[key]) ? 'new'
        : data[key];
      values.push(value ?? null);
    }
  }

  if ('custom_fields' in data) {
    // Sanitize against the *effective* business unit — the one being set
    // in this same patch if present, otherwise whatever the org already
    // has — so custom_fields is always validated against the right field
    // set even when both change together.
    const effectiveBusinessUnit = data.business_unit ?? (await getOrganisation(platformOrgId, organisationId))?.business_unit;
    const sanitized = sanitizeCustomFields(effectiveBusinessUnit, data.custom_fields);
    sets.push(`custom_fields = $${i++}::jsonb`);
    values.push(JSON.stringify(sanitized));
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
