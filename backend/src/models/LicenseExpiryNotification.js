import { query } from '../config/database.js';

/**
 * Atomically claim a (organization_id, contract_end, threshold_days)
 * notification slot. Returns the row when this caller wins; returns null
 * when an earlier sweep already claimed it. Combined with a UNIQUE
 * constraint, this is the single source of truth for "have we already
 * notified this licensee at this threshold for this contract window".
 */
export async function tryClaimNotification({
  organizationId,
  contractEnd,
  thresholdDays,
  recipientsCount = 0,
  metadata = {},
}) {
  if (!organizationId || !contractEnd || !Number.isInteger(thresholdDays)) return null;
  const { rows } = await query(
    `INSERT INTO licence_expiry_notifications
       (organization_id, contract_end, threshold_days, recipients_count, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (organization_id, contract_end, threshold_days) DO NOTHING
     RETURNING *`,
    [
      organizationId,
      contractEnd,
      thresholdDays,
      recipientsCount,
      JSON.stringify(metadata || {}),
    ]
  );
  return rows[0] || null;
}

export async function listForOrganization(organizationId, { limit = 50 } = {}) {
  if (!organizationId) return [];
  const cappedLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 50, 1), 500);
  const { rows } = await query(
    `SELECT * FROM licence_expiry_notifications
     WHERE organization_id = $1
     ORDER BY sent_at DESC
     LIMIT $2`,
    [organizationId, cappedLimit]
  );
  return rows;
}

export function publicNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    contractEnd: row.contract_end,
    thresholdDays: row.threshold_days,
    recipientsCount: row.recipients_count,
    metadata: row.metadata || {},
    sentAt: row.sent_at,
  };
}
