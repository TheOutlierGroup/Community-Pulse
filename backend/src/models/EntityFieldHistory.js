import { query } from '../config/database.js';

export const ENTITY_TYPES = ['organization', 'licence_config'];

/**
 * Writes one row per changed field (see auditLog.js's diffFields()) so
 * staff can later revert a single field to its prior value without
 * touching the immutable audit_events stream. Returns the inserted rows.
 */
export async function recordFieldChanges({
  organizationId,
  entityType,
  entityId,
  changes,
  changedBy = null,
  auditEventId = null,
  revertOfId = null,
}) {
  if (!organizationId || !entityType || !entityId || !changes) return [];
  const entries = Object.entries(changes);
  if (entries.length === 0) return [];
  const rows = [];
  for (const [fieldName, { from, to }] of entries) {
    const { rows: inserted } = await query(
      `INSERT INTO entity_field_history (
         organization_id, entity_type, entity_id, field_name,
         old_value, new_value, changed_by, audit_event_id, revert_of_id
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)
       RETURNING *`,
      [
        organizationId,
        entityType,
        entityId,
        fieldName,
        JSON.stringify(from ?? null),
        JSON.stringify(to ?? null),
        changedBy,
        auditEventId,
        revertOfId,
      ]
    );
    rows.push(inserted[0]);
  }
  return rows;
}

export async function getHistoryById(id) {
  if (!id) return null;
  const { rows } = await query(`SELECT * FROM entity_field_history WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function listHistoryForOrganization(organizationId, { limit = 50 } = {}) {
  if (!organizationId) return [];
  const cappedLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 50, 1), 200);
  const { rows } = await query(
    `SELECT * FROM entity_field_history
     WHERE organization_id = $1
     ORDER BY changed_at DESC
     LIMIT $2`,
    [organizationId, cappedLimit]
  );
  return rows;
}

/**
 * Marks a history row as reverted. Callers do this after successfully
 * writing the old value back through the entity's normal update path (so
 * the revert itself creates a fresh audit event + history row) — this
 * stamp just prevents the same row from being "reverted" twice.
 */
export async function markReverted(id, revertedBy) {
  if (!id) return null;
  const { rows } = await query(
    `UPDATE entity_field_history
     SET reverted_at = NOW(), reverted_by = $2
     WHERE id = $1 AND reverted_at IS NULL
     RETURNING *`,
    [id, revertedBy]
  );
  return rows[0] || null;
}

export function publicHistoryRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    fieldName: row.field_name,
    oldValue: row.old_value,
    newValue: row.new_value,
    changedBy: row.changed_by,
    changedAt: row.changed_at,
    auditEventId: row.audit_event_id,
    revertedAt: row.reverted_at,
    revertedBy: row.reverted_by,
    revertOfId: row.revert_of_id,
  };
}
