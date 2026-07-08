import { query } from '../config/database.js';

function normalizeSlug(value) {
  const base = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || null;
}

function defaultClientStatusForKind(kind) {
  // Client status is now Current/Previous only — "Prospect" statuses live
  // exclusively in the CRM Prospects layer, so a freshly created client or
  // licensee org starts out as an active/current relationship.
  if (kind === 'client' || kind === 'licensee') return 'client-current';
  return 'active';
}

export async function createOrganization(
  name,
  settings = {},
  kind = 'client',
  clientStatus = defaultClientStatusForKind(kind),
  { parentOrganizationId = null } = {}
) {
  const baseSlug = normalizeSlug(name);
  let slug = baseSlug;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const { rows } = await query(
        `INSERT INTO organizations (name, slug, settings, kind, client_status, parent_organization_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [name, slug, JSON.stringify(settings), kind, clientStatus, parentOrganizationId]
      );
      return rows[0];
    } catch (err) {
      const constraint = String(err?.constraint || '').toLowerCase();
      const isSlugConflict = err?.code === '23505' && constraint.includes('slug');
      if (!isSlugConflict || !baseSlug || attempt >= 5) throw err;
      const suffix = Math.random().toString(36).slice(2, 6);
      slug = `${baseSlug}-${suffix}`;
    }
  }
  throw new Error('Could not create organization');
}

export async function getOrganization(id) {
  const { rows } = await query(`SELECT * FROM organizations WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function getOrganizationBySlug(slug) {
  const normalized = normalizeSlug(slug);
  if (!normalized) return null;
  const { rows } = await query(`SELECT * FROM organizations WHERE lower(slug) = lower($1)`, [normalized]);
  return rows[0] || null;
}

export async function getFirstOrganizationByKind(kind) {
  const { rows } = await query(
    `SELECT * FROM organizations WHERE kind = $1 ORDER BY created_at ASC LIMIT 1`,
    [kind]
  );
  return rows[0] || null;
}

const CLIENT_LIST_COLUMNS = `id, name, slug, kind, settings, created_at, updated_at, company_logo_filename,
            client_status, relationship_status, hierarchy_levels, report_contact, parent_organization_id`;

export async function listOrganizationsByKind(kind, { limit, offset } = {}) {
  const cappedLimit =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 200;
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const { rows } = await query(
    `SELECT ${CLIENT_LIST_COLUMNS}
     FROM organizations
     WHERE kind = $1
     ORDER BY created_at ASC
     LIMIT $2 OFFSET $3`,
    [kind, cappedLimit, safeOffset]
  );
  return rows;
}

export async function listClientAndLicenseeOrganizations({ limit, offset } = {}) {
  const cappedLimit =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 200;
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const { rows } = await query(
    `SELECT ${CLIENT_LIST_COLUMNS}
     FROM organizations
     WHERE kind IN ('client', 'licensee')
     ORDER BY created_at ASC
     LIMIT $1 OFFSET $2`,
    [cappedLimit, safeOffset]
  );
  return rows;
}

export async function listClientOrganizationsForParent(parentOrganizationId, { limit, offset } = {}) {
  if (!parentOrganizationId) return [];
  const cappedLimit =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 200;
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const { rows } = await query(
    `SELECT ${CLIENT_LIST_COLUMNS}
     FROM organizations
     WHERE kind = 'client' AND parent_organization_id = $1
     ORDER BY created_at ASC
     LIMIT $2 OFFSET $3`,
    [parentOrganizationId, cappedLimit, safeOffset]
  );
  return rows;
}

export async function listClientOrganizationsByIds(ids, { limit, offset } = {}) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const cappedLimit =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 500;
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const { rows } = await query(
    `SELECT ${CLIENT_LIST_COLUMNS}
     FROM organizations
     WHERE kind = 'client' AND id = ANY($1::uuid[])
     ORDER BY created_at ASC
     LIMIT $2 OFFSET $3`,
    [ids, cappedLimit, safeOffset]
  );
  return rows;
}

export async function isClientOrganizationOwnedByParent(clientOrgId, parentOrganizationId) {
  if (!clientOrgId || !parentOrganizationId) return false;
  const { rows } = await query(
    `SELECT 1
     FROM organizations
     WHERE id = $1 AND kind = 'client' AND parent_organization_id = $2
     LIMIT 1`,
    [clientOrgId, parentOrganizationId]
  );
  return rows.length > 0;
}

export async function setCompanyLogoFilename(id, filename) {
  const { rows } = await query(
    `UPDATE organizations
     SET company_logo_filename = $2, updated_at = NOW()
     WHERE id = $1 AND kind IN ('client', 'licensee')
     RETURNING *`,
    [id, filename]
  );
  return rows[0] || null;
}

export async function clearCompanyLogoFilename(id) {
  const org = await getOrganization(id);
  const prev = org?.company_logo_filename || null;
  await query(`UPDATE organizations SET company_logo_filename = NULL, updated_at = NOW() WHERE id = $1`, [id]);
  return prev;
}

export async function updateOrganizationClient(id, { name, settings, clientStatus, relationshipStatus } = {}) {
  const org = await getOrganization(id);
  if (!org || (org.kind !== 'client' && org.kind !== 'licensee')) return null;
  const nextName = name !== undefined ? name : org.name;
  const nextSlug = name !== undefined ? normalizeSlug(name) : org.slug;
  const nextClientStatus = clientStatus !== undefined ? clientStatus : org.client_status;
  const nextRelationshipStatus = relationshipStatus !== undefined ? relationshipStatus : org.relationship_status;
  const base =
    org.settings && typeof org.settings === 'object' ? org.settings : {};
  let nextSettings = base;
  if (settings !== undefined && typeof settings === 'object') {
    nextSettings = { ...base, ...settings };
  }
  const { rows } = await query(
    `UPDATE organizations
     SET name = $2, slug = $3, settings = $4::jsonb, client_status = $5, relationship_status = $6, updated_at = NOW()
     WHERE id = $1 AND kind IN ('client', 'licensee')
     RETURNING *`,
    [id, nextName, nextSlug, JSON.stringify(nextSettings), nextClientStatus, nextRelationshipStatus]
  );
  return rows[0] || null;
}

export async function updateOrganizationSettings(id, settings) {
  const org = await getOrganization(id);
  if (!org) return null;
  const base =
    org.settings && typeof org.settings === 'object' && !Array.isArray(org.settings)
      ? org.settings
      : {};
  const patch =
    settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  const nextSettings = { ...base, ...patch };
  const { rows } = await query(
    `UPDATE organizations SET settings = $2::jsonb, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(nextSettings)]
  );
  return rows[0] || null;
}

export async function markOrganizationArchived(id, { disposalYears = 7 } = {}) {
  const years = Number.isFinite(disposalYears) && disposalYears > 0 ? Math.floor(disposalYears) : 7;
  const { rows } = await query(
    `UPDATE organizations
     SET archived_at = COALESCE(archived_at, NOW()),
         tier3_archive_at = COALESCE(tier3_archive_at, NOW()),
         tier3_disposal_due_at = COALESCE(
           tier3_disposal_due_at,
           NOW() + make_interval(years => $2::int)
         )
     WHERE id = $1
     RETURNING *`,
    [id, years]
  );
  return rows[0] || null;
}

export async function deleteOrganization(id) {
  const org = await getOrganization(id);
  if (!org || (org.kind !== 'client' && org.kind !== 'licensee')) return null;
  await query(
    `DELETE FROM organizations WHERE id = $1 AND kind IN ('client', 'licensee')`,
    [id]
  );
  return org;
}

export async function listArchivedOrganizations() {
  const { rows } = await query(
    `SELECT id, name, archived_at, tier3_archive_at, tier3_disposal_due_at
     FROM organizations
     WHERE archived_at IS NOT NULL
     ORDER BY tier3_disposal_due_at ASC NULLS LAST, archived_at ASC`
  );
  return rows;
}
