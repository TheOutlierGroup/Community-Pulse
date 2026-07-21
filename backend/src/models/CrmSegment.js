import { query } from '../config/database.js';

// A segment is a named, saved filter over the contacts list. Its `definition`
// is a small, whitelisted set of predicates that map onto contact fields — the
// same dimensions the Contacts page filters on. The predicate set is applied
// on the client today (see frontend/src/utils/segments.js); this normaliser is
// the server-side gatekeeper so only known keys/types ever land in the DB.

const LINK_TYPES = new Set(['', 'prospect', 'client', 'unlinked']);
const RELATIONSHIP_STATUSES = new Set(['warm', 'cold', 'lost', 'new']);
const SCOPES = new Set(['personal', 'shared']);

function normalizeDefinition(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const linkType = typeof src.linkType === 'string' && LINK_TYPES.has(src.linkType) ? src.linkType : '';
  const relationshipStatuses = Array.isArray(src.relationshipStatuses)
    ? [...new Set(src.relationshipStatuses.filter((s) => RELATIONSHIP_STATUSES.has(s)))]
    : [];
  return {
    search: typeof src.search === 'string' ? src.search.trim().slice(0, 200) : '',
    linkType,
    businessUnit: typeof src.businessUnit === 'string' ? src.businessUnit.trim().slice(0, 120) : '',
    roleContains: typeof src.roleContains === 'string' ? src.roleContains.trim().slice(0, 120) : '',
    relationshipStatuses,
    hasEmail: src.hasEmail === true,
    hasPhone: src.hasPhone === true,
  };
}

// Shape a DB row for the API: parse nothing (pg returns JSONB as an object),
// but always hand back a fully-normalised definition so the client never has
// to defend against a legacy/partial blob.
function shapeSegment(row) {
  if (!row) return null;
  return { ...row, definition: normalizeDefinition(row.definition) };
}

export function normalizeScope(value) {
  return SCOPES.has(value) ? value : 'personal';
}

// Visible = every shared segment in the workspace + the caller's own personal
// segments. Personal segments owned by someone else are never returned.
export async function listSegmentsForUser(platformOrgId, userId) {
  const { rows } = await query(
    `SELECT s.*, u.first_name AS owner_first_name, u.last_name AS owner_last_name
       FROM crm_segments s
       LEFT JOIN users u ON u.id = s.owner_user_id
      WHERE s.platform_org_id = $1
        AND (s.scope = 'shared' OR s.owner_user_id = $2)
      ORDER BY s.scope ASC, LOWER(s.name) ASC`,
    [platformOrgId, userId],
  );
  return rows.map(shapeSegment);
}

export async function getSegment(platformOrgId, segmentId) {
  const { rows } = await query(
    `SELECT * FROM crm_segments WHERE segment_id = $1 AND platform_org_id = $2`,
    [segmentId, platformOrgId],
  );
  return shapeSegment(rows[0]);
}

export async function createSegment(platformOrgId, data, userId) {
  const scope = normalizeScope(data.scope);
  const { rows } = await query(
    `INSERT INTO crm_segments
       (name, description, definition, scope, business_unit, owner_user_id, platform_org_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      String(data.name || '').trim(),
      data.description ? String(data.description).trim() : null,
      JSON.stringify(normalizeDefinition(data.definition)),
      scope,
      data.business_unit ? String(data.business_unit).trim() : null,
      // Shared segments are workspace-owned, not tied to their author's
      // personal list — leave owner null so they surface for everyone.
      scope === 'personal' ? userId : null,
      platformOrgId,
      userId,
    ],
  );
  return shapeSegment(rows[0]);
}

export async function updateSegment(platformOrgId, segmentId, data) {
  const sets = [];
  const values = [];
  let i = 1;

  if ('name' in data) { sets.push(`name = $${i++}`); values.push(String(data.name || '').trim()); }
  if ('description' in data) { sets.push(`description = $${i++}`); values.push(data.description ? String(data.description).trim() : null); }
  if ('definition' in data) { sets.push(`definition = $${i++}`); values.push(JSON.stringify(normalizeDefinition(data.definition))); }
  if ('business_unit' in data) { sets.push(`business_unit = $${i++}`); values.push(data.business_unit ? String(data.business_unit).trim() : null); }
  // scope is deliberately not editable here — flipping personal<->shared would
  // change who owns/sees a segment; treat that as delete-and-recreate instead.

  if (sets.length === 0) return getSegment(platformOrgId, segmentId);

  sets.push('updated_at = NOW()');
  values.push(segmentId, platformOrgId);

  const { rows } = await query(
    `UPDATE crm_segments SET ${sets.join(', ')}
      WHERE segment_id = $${i++} AND platform_org_id = $${i++}
      RETURNING *`,
    values,
  );
  return shapeSegment(rows[0]);
}

export async function deleteSegment(platformOrgId, segmentId) {
  await query(`DELETE FROM crm_segments WHERE segment_id = $1 AND platform_org_id = $2`, [segmentId, platformOrgId]);
}
