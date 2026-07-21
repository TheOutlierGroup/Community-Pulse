import { query } from '../config/database.js';

// A custom filter is a named, saved filter over the contacts list. Its
// `definition` is a small, whitelisted set of predicates that map onto contact
// fields — the same dimensions the Contacts page filters on. The predicate set
// is applied on the client today (see frontend/src/utils/customFilters.js);
// this normaliser is the server-side gatekeeper so only known keys/types ever
// land in the DB. Stored in the crm_custom_filters table.

const LINK_TYPES = new Set(['', 'prospect', 'client', 'unlinked']);
const RELATIONSHIP_STATUSES = new Set(['warm', 'cold', 'lost', 'new']);
const CONTACT_SOURCES = new Set(['manual', 'linkedin', 'firmable']);
const SCOPES = new Set(['personal', 'shared']);

// Personal custom filters a single non-admin user may keep. Admins are not
// capped (and shared filters, which only admins create, are never counted).
export const MAX_PERSONAL_CUSTOM_FILTERS = 10;

function normalizeDefinition(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const linkType = typeof src.linkType === 'string' && LINK_TYPES.has(src.linkType) ? src.linkType : '';
  const relationshipStatuses = Array.isArray(src.relationshipStatuses)
    ? [...new Set(src.relationshipStatuses.filter((s) => RELATIONSHIP_STATUSES.has(s)))]
    : [];
  const sources = Array.isArray(src.sources)
    ? [...new Set(src.sources.filter((s) => CONTACT_SOURCES.has(s)))]
    : [];
  return {
    search: typeof src.search === 'string' ? src.search.trim().slice(0, 200) : '',
    linkType,
    businessUnit: typeof src.businessUnit === 'string' ? src.businessUnit.trim().slice(0, 120) : '',
    roleContains: typeof src.roleContains === 'string' ? src.roleContains.trim().slice(0, 120) : '',
    relationshipStatuses,
    sources,
    hasEmail: src.hasEmail === true,
    hasPhone: src.hasPhone === true,
  };
}

// Shape a DB row for the API: pg returns JSONB as an object; always hand back a
// fully-normalised definition so the client never has to defend against a
// legacy/partial blob.
function shapeCustomFilter(row) {
  if (!row) return null;
  return { ...row, definition: normalizeDefinition(row.definition) };
}

export function normalizeScope(value) {
  return SCOPES.has(value) ? value : 'personal';
}

// Visible = every shared custom filter in the workspace + the caller's own
// personal filters. Personal filters owned by someone else are never returned.
export async function listCustomFiltersForUser(platformOrgId, userId) {
  const { rows } = await query(
    `SELECT f.*, u.first_name AS owner_first_name, u.last_name AS owner_last_name
       FROM crm_custom_filters f
       LEFT JOIN users u ON u.id = f.owner_user_id
      WHERE f.platform_org_id = $1
        AND (f.scope = 'shared' OR f.owner_user_id = $2)
      ORDER BY f.scope ASC, LOWER(f.name) ASC`,
    [platformOrgId, userId],
  );
  return rows.map(shapeCustomFilter);
}

export async function countPersonalCustomFilters(platformOrgId, userId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM crm_custom_filters
      WHERE platform_org_id = $1 AND scope = 'personal' AND owner_user_id = $2`,
    [platformOrgId, userId],
  );
  return rows[0]?.n || 0;
}

export async function getCustomFilter(platformOrgId, filterId) {
  const { rows } = await query(
    `SELECT * FROM crm_custom_filters WHERE filter_id = $1 AND platform_org_id = $2`,
    [filterId, platformOrgId],
  );
  return shapeCustomFilter(rows[0]);
}

export async function createCustomFilter(platformOrgId, data, userId) {
  const scope = normalizeScope(data.scope);
  const { rows } = await query(
    `INSERT INTO crm_custom_filters
       (name, description, definition, scope, business_unit, owner_user_id, platform_org_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      String(data.name || '').trim(),
      data.description ? String(data.description).trim() : null,
      JSON.stringify(normalizeDefinition(data.definition)),
      scope,
      data.business_unit ? String(data.business_unit).trim() : null,
      // Shared filters are workspace-owned, not tied to their author's personal
      // list — leave owner null so they surface for everyone.
      scope === 'personal' ? userId : null,
      platformOrgId,
      userId,
    ],
  );
  return shapeCustomFilter(rows[0]);
}

export async function updateCustomFilter(platformOrgId, filterId, data) {
  const sets = [];
  const values = [];
  let i = 1;

  if ('name' in data) { sets.push(`name = $${i++}`); values.push(String(data.name || '').trim()); }
  if ('description' in data) { sets.push(`description = $${i++}`); values.push(data.description ? String(data.description).trim() : null); }
  if ('definition' in data) { sets.push(`definition = $${i++}`); values.push(JSON.stringify(normalizeDefinition(data.definition))); }
  if ('business_unit' in data) { sets.push(`business_unit = $${i++}`); values.push(data.business_unit ? String(data.business_unit).trim() : null); }
  // scope is deliberately not editable here — flipping personal<->shared would
  // change who owns/sees a filter; treat that as delete-and-recreate instead.

  if (sets.length === 0) return getCustomFilter(platformOrgId, filterId);

  sets.push('updated_at = NOW()');
  values.push(filterId, platformOrgId);

  const { rows } = await query(
    `UPDATE crm_custom_filters SET ${sets.join(', ')}
      WHERE filter_id = $${i++} AND platform_org_id = $${i++}
      RETURNING *`,
    values,
  );
  return shapeCustomFilter(rows[0]);
}

export async function deleteCustomFilter(platformOrgId, filterId) {
  await query(`DELETE FROM crm_custom_filters WHERE filter_id = $1 AND platform_org_id = $2`, [filterId, platformOrgId]);
}
