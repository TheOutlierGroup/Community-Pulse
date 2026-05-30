import { query } from '../config/database.js';

export const BU_ROLES = ['bu_manager', 'sales_rep', 'delivery', 'viewer'];

export async function createBusinessUnit(organizationId, { name, code, description, settings = {}, createdBy = null }) {
  const { rows } = await query(
    `INSERT INTO business_units (organization_id, name, code, description, settings, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING *`,
    [organizationId, String(name).trim(), code ? String(code).trim() : null, description || null, JSON.stringify(settings), createdBy]
  );
  return rows[0];
}

export async function getBusinessUnit(id) {
  const { rows } = await query(`SELECT * FROM business_units WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function listBusinessUnits(organizationId, { includeInactive = false } = {}) {
  const { rows } = await query(
    `SELECT * FROM business_units
     WHERE organization_id = $1 ${includeInactive ? '' : 'AND is_active = TRUE'}
     ORDER BY name ASC`,
    [organizationId]
  );
  return rows;
}

export async function updateBusinessUnit(id, { name, code, description, settings, isActive }) {
  const bu = await getBusinessUnit(id);
  if (!bu) return null;
  const { rows } = await query(
    `UPDATE business_units
     SET name        = COALESCE($2, name),
         code        = COALESCE($3, code),
         description = COALESCE($4, description),
         settings    = CASE WHEN $5::text IS NOT NULL THEN $5::jsonb ELSE settings END,
         is_active   = COALESCE($6, is_active),
         updated_at  = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, name || null, code || null, description || null, settings != null ? JSON.stringify(settings) : null, isActive ?? null]
  );
  return rows[0] || null;
}

export async function deleteBusinessUnit(id) {
  const bu = await getBusinessUnit(id);
  if (!bu) return null;
  await query(`DELETE FROM business_units WHERE id = $1`, [id]);
  return bu;
}

// ── Members ──────────────────────────────────────────────────────────────────

export async function addMember(businessUnitId, userId, buRole = 'viewer') {
  const role = BU_ROLES.includes(buRole) ? buRole : 'viewer';
  const { rows } = await query(
    `INSERT INTO business_unit_members (business_unit_id, user_id, bu_role)
     VALUES ($1, $2, $3)
     ON CONFLICT (business_unit_id, user_id) DO UPDATE SET bu_role = EXCLUDED.bu_role
     RETURNING *`,
    [businessUnitId, userId, role]
  );
  return rows[0];
}

export async function removeMember(businessUnitId, userId) {
  await query(
    `DELETE FROM business_unit_members WHERE business_unit_id = $1 AND user_id = $2`,
    [businessUnitId, userId]
  );
}

export async function listMembers(businessUnitId) {
  const { rows } = await query(
    `SELECT m.*, u.email, u.first_name, u.last_name, u.role as org_role
     FROM business_unit_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.business_unit_id = $1
     ORDER BY u.first_name ASC, u.last_name ASC`,
    [businessUnitId]
  );
  return rows;
}

export async function getUserBuRole(businessUnitId, userId) {
  const { rows } = await query(
    `SELECT bu_role FROM business_unit_members WHERE business_unit_id = $1 AND user_id = $2`,
    [businessUnitId, userId]
  );
  return rows[0]?.bu_role || null;
}

export async function listBusForUser(userId, organizationId) {
  const { rows } = await query(
    `SELECT bu.*, m.bu_role
     FROM business_units bu
     JOIN business_unit_members m ON m.business_unit_id = bu.id
     WHERE m.user_id = $1 AND bu.organization_id = $2 AND bu.is_active = TRUE
     ORDER BY bu.name ASC`,
    [userId, organizationId]
  );
  return rows;
}

export async function businessUnitBelongsToOrg(buId, organizationId) {
  const { rows } = await query(
    `SELECT 1 FROM business_units WHERE id = $1 AND organization_id = $2`,
    [buId, organizationId]
  );
  return rows.length > 0;
}
