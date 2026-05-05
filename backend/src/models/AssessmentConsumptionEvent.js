import { query } from '../config/database.js';

export const SOURCE_PLATFORM_DURING_CHECKPOINT = 'platform_during_checkpoint';
export const SOURCE_CLIENT_ADMIN_SESSION = 'client_admin_session';
export const SOURCE_PLATFORM_SESSION_CREATE = 'platform_session_create';
export const SOURCE_MANUAL_OVERRIDE = 'manual_override';
export const SOURCE_MANUAL_REFUND = 'manual_refund';

export const SOURCES = [
  SOURCE_PLATFORM_DURING_CHECKPOINT,
  SOURCE_CLIENT_ADMIN_SESSION,
  SOURCE_PLATFORM_SESSION_CREATE,
  SOURCE_MANUAL_OVERRIDE,
  SOURCE_MANUAL_REFUND,
];

export async function recordEvent({
  licenseeOrganizationId,
  clientOrganizationId,
  pulseSessionId = null,
  source,
  assessmentsCharged = 1,
  actorUserId = null,
  metadata = {},
}) {
  if (!licenseeOrganizationId || !clientOrganizationId || !source) return null;
  const { rows } = await query(
    `INSERT INTO assessment_consumption_events
       (licensee_organization_id, client_organization_id, pulse_session_id,
        source, assessments_charged, actor_user_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING *`,
    [
      licenseeOrganizationId,
      clientOrganizationId,
      pulseSessionId,
      source,
      assessmentsCharged,
      actorUserId,
      JSON.stringify(metadata || {}),
    ]
  );
  return rows[0] || null;
}

export async function listForLicensee(licenseeOrganizationId, { limit = 100 } = {}) {
  if (!licenseeOrganizationId) return [];
  const cappedLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 100, 1), 500);
  const { rows } = await query(
    `SELECT ace.*, co.name AS client_organization_name
     FROM assessment_consumption_events ace
     LEFT JOIN organizations co ON co.id = ace.client_organization_id
     WHERE ace.licensee_organization_id = $1
     ORDER BY ace.created_at DESC
     LIMIT $2`,
    [licenseeOrganizationId, cappedLimit]
  );
  return rows;
}

/**
 * Phase 2 reconciliation: ordered ledger of every consume / refund event
 * for a licensee inside [from, to). Returned ascending so the resulting
 * CSV is naturally chronological. No row cap — this is the source of
 * truth for billing reconciliation, so callers (the export endpoint)
 * stream it back with no truncation.
 */
export async function listForLicenseeBetween(licenseeOrganizationId, fromIso, toIso) {
  if (!licenseeOrganizationId || !fromIso || !toIso) return [];
  const { rows } = await query(
    `SELECT ace.*, co.name AS client_organization_name
     FROM assessment_consumption_events ace
     LEFT JOIN organizations co ON co.id = ace.client_organization_id
     WHERE ace.licensee_organization_id = $1
       AND ace.created_at >= $2
       AND ace.created_at < $3
     ORDER BY ace.created_at ASC`,
    [licenseeOrganizationId, fromIso, toIso]
  );
  return rows;
}

/**
 * Phase 2 reconciliation summary: net charged (consumes - refunds) and
 * counts of distinct events / clients in the same window. Cheap one-shot
 * aggregate the export endpoint includes alongside the row-level CSV so
 * billing teams don't have to sum the rows themselves.
 */
export async function summariseForLicenseeBetween(licenseeOrganizationId, fromIso, toIso) {
  if (!licenseeOrganizationId || !fromIso || !toIso) {
    return { netCharged: 0, eventCount: 0, distinctClients: 0 };
  }
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(assessments_charged), 0)::int AS net_charged,
       COUNT(*)::int AS event_count,
       COUNT(DISTINCT client_organization_id)::int AS distinct_clients
     FROM assessment_consumption_events
     WHERE licensee_organization_id = $1
       AND created_at >= $2
       AND created_at < $3`,
    [licenseeOrganizationId, fromIso, toIso]
  );
  const r = rows[0] || {};
  return {
    netCharged: r.net_charged ?? 0,
    eventCount: r.event_count ?? 0,
    distinctClients: r.distinct_clients ?? 0,
  };
}

export function publicEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    licenseeOrganizationId: row.licensee_organization_id,
    clientOrganizationId: row.client_organization_id,
    clientOrganizationName: row.client_organization_name || null,
    pulseSessionId: row.pulse_session_id,
    source: row.source,
    assessmentsCharged: row.assessments_charged,
    actorUserId: row.actor_user_id,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}
