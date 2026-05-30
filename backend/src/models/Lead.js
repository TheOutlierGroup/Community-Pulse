import { query } from '../config/database.js';

export const LEAD_ACTIVITY_TYPES = {
  CREATED: 'created',
  STAGE_CHANGED: 'stage_changed',
  ASSIGNED: 'assigned',
  WON: 'won',
  LOST: 'lost',
  NOTE_ADDED: 'note_added',
  ESTIMATE_ADDED: 'estimate_added',
  ESTIMATE_REMOVED: 'estimate_removed',
  FIELD_UPDATED: 'field_updated',
};

// ── Leads ─────────────────────────────────────────────────────────────────────

export async function createLead(organizationId, {
  businessUnitId, accountId, contactId, pipelineStageId,
  title, description, source, sourceMetadata = {}, assignedTo = null,
  expectedCloseDate = null, customFields = {}, createdBy = null,
}) {
  const { rows } = await query(
    `INSERT INTO leads
       (organization_id, business_unit_id, account_id, contact_id, pipeline_stage_id,
        title, description, source, source_metadata, assigned_to,
        expected_close_date, custom_fields, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::jsonb,$13)
     RETURNING *`,
    [
      organizationId, businessUnitId, accountId, contactId, pipelineStageId,
      String(title).trim(), description || null, source || null,
      JSON.stringify(sourceMetadata), assignedTo || null,
      expectedCloseDate || null, JSON.stringify(customFields), createdBy || null,
    ]
  );
  return rows[0];
}

export async function getLead(id) {
  const { rows } = await query(
    `SELECT l.*,
            a.name AS account_name,
            c.first_name || ' ' || c.last_name AS contact_name,
            c.email AS contact_email,
            ps.name AS stage_name,
            ps.is_won AS stage_is_won,
            ps.is_lost AS stage_is_lost,
            bu.name AS bu_name
     FROM leads l
     JOIN accounts a ON a.id = l.account_id
     JOIN contacts c ON c.id = l.contact_id
     JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id
     JOIN business_units bu ON bu.id = l.business_unit_id
     WHERE l.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function listLeads(organizationId, {
  businessUnitId, pipelineStageId, assignedTo, search,
  wonOnly, lostOnly, openOnly, limit = 100, offset = 0,
} = {}) {
  const cap = Math.min(Number(limit) || 100, 500);
  const off = Math.max(Number(offset) || 0, 0);
  const conditions = ['l.organization_id = $1'];
  const params = [organizationId];
  let p = 2;

  if (businessUnitId) { conditions.push(`l.business_unit_id = $${p++}`); params.push(businessUnitId); }
  if (pipelineStageId) { conditions.push(`l.pipeline_stage_id = $${p++}`); params.push(pipelineStageId); }
  if (assignedTo) { conditions.push(`l.assigned_to = $${p++}`); params.push(assignedTo); }
  if (search) { conditions.push(`l.title ILIKE $${p++}`); params.push(`%${search}%`); }
  if (wonOnly) conditions.push('l.won_at IS NOT NULL');
  if (lostOnly) conditions.push('l.lost_at IS NOT NULL');
  if (openOnly) conditions.push('l.won_at IS NULL AND l.lost_at IS NULL');

  params.push(cap, off);
  const { rows } = await query(
    `SELECT l.*, a.name AS account_name,
            c.first_name || ' ' || c.last_name AS contact_name,
            ps.name AS stage_name, ps.is_won AS stage_is_won, ps.is_lost AS stage_is_lost,
            bu.name AS bu_name
     FROM leads l
     JOIN accounts a ON a.id = l.account_id
     JOIN contacts c ON c.id = l.contact_id
     JOIN pipeline_stages ps ON ps.id = l.pipeline_stage_id
     JOIN business_units bu ON bu.id = l.business_unit_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY l.created_at DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    params
  );
  return rows;
}

export async function updateLead(id, {
  title, description, pipelineStageId, assignedTo,
  expectedCloseDate, customFields, source,
} = {}) {
  const lead = await getLead(id);
  if (!lead) return null;
  if (lead.locked_at) return { _locked: true };
  const { rows } = await query(
    `UPDATE leads
     SET title              = COALESCE($2, title),
         description        = COALESCE($3, description),
         pipeline_stage_id  = COALESCE($4, pipeline_stage_id),
         assigned_to        = CASE WHEN $5::text IS NOT NULL THEN $5::uuid ELSE assigned_to END,
         expected_close_date= COALESCE($6, expected_close_date),
         custom_fields      = CASE WHEN $7::text IS NOT NULL THEN $7::jsonb ELSE custom_fields END,
         source             = COALESCE($8, source),
         updated_at         = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      title || null, description !== undefined ? description : null,
      pipelineStageId || null, assignedTo !== undefined ? String(assignedTo) : null,
      expectedCloseDate !== undefined ? expectedCloseDate : null,
      customFields != null ? JSON.stringify(customFields) : null,
      source || null,
    ]
  );
  return rows[0] || null;
}

export async function markLeadWon(id, actorId) {
  const { rows } = await query(
    `UPDATE leads
     SET won_at = NOW(), locked_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND won_at IS NULL AND lost_at IS NULL
     RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

export async function markLeadLost(id, reason = null) {
  const { rows } = await query(
    `UPDATE leads
     SET lost_at = NOW(), lost_reason = $2, updated_at = NOW()
     WHERE id = $1 AND won_at IS NULL AND lost_at IS NULL
     RETURNING *`,
    [id, reason || null]
  );
  return rows[0] || null;
}

export async function leadBelongsToOrg(leadId, organizationId) {
  const { rows } = await query(
    `SELECT 1 FROM leads WHERE id = $1 AND organization_id = $2`,
    [leadId, organizationId]
  );
  return rows.length > 0;
}

// ── Estimates ─────────────────────────────────────────────────────────────────

export async function addEstimate(leadId, { description, hours, unitCost, quantity = 1, position = 0 }) {
  const { rows } = await query(
    `INSERT INTO lead_estimates (lead_id, description, hours, unit_cost, quantity, position)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [leadId, String(description).trim(), hours != null ? Number(hours) : null, unitCost != null ? Number(unitCost) : null, Number(quantity), Number(position)]
  );
  return rows[0];
}

export async function listEstimates(leadId) {
  const { rows } = await query(
    `SELECT * FROM lead_estimates WHERE lead_id = $1 ORDER BY position ASC, created_at ASC`,
    [leadId]
  );
  return rows;
}

export async function updateEstimate(id, { description, hours, unitCost, quantity, position } = {}) {
  const { rows } = await query(
    `UPDATE lead_estimates
     SET description = COALESCE($2, description),
         hours       = COALESCE($3, hours),
         unit_cost   = COALESCE($4, unit_cost),
         quantity    = COALESCE($5, quantity),
         position    = COALESCE($6, position),
         updated_at  = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, description || null, hours != null ? Number(hours) : null, unitCost != null ? Number(unitCost) : null, quantity != null ? Number(quantity) : null, position != null ? Number(position) : null]
  );
  return rows[0] || null;
}

export async function deleteEstimate(id) {
  await query(`DELETE FROM lead_estimates WHERE id = $1`, [id]);
}

export async function sumEstimates(leadId) {
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(hours * quantity), 0)::numeric AS total_hours,
       COALESCE(SUM(unit_cost * quantity), 0)::numeric AS total_cost
     FROM lead_estimates WHERE lead_id = $1`,
    [leadId]
  );
  return { totalHours: Number(rows[0]?.total_hours || 0), totalCost: Number(rows[0]?.total_cost || 0) };
}

// ── Activity log ──────────────────────────────────────────────────────────────

export async function logActivity(leadId, actorId, eventType, payload = {}) {
  await query(
    `INSERT INTO lead_activity (lead_id, actor_id, event_type, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [leadId, actorId || null, eventType, JSON.stringify(payload)]
  );
}

export async function listActivity(leadId, { limit = 50, offset = 0 } = {}) {
  const { rows } = await query(
    `SELECT la.*, u.email AS actor_email, u.first_name AS actor_first_name, u.last_name AS actor_last_name
     FROM lead_activity la
     LEFT JOIN users u ON u.id = la.actor_id
     WHERE la.lead_id = $1
     ORDER BY la.created_at DESC
     LIMIT $2 OFFSET $3`,
    [leadId, Math.min(Number(limit) || 50, 200), Math.max(Number(offset) || 0, 0)]
  );
  return rows;
}

// ── Routing rules ─────────────────────────────────────────────────────────────

export async function createRoutingRule(organizationId, { businessUnitId, fieldPath, fieldValue, priority = 100, createdBy = null }) {
  const { rows } = await query(
    `INSERT INTO lead_routing_rules (organization_id, business_unit_id, field_path, field_value, priority, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [organizationId, businessUnitId, String(fieldPath).trim(), String(fieldValue).trim(), Number(priority), createdBy || null]
  );
  return rows[0];
}

export async function listRoutingRules(organizationId) {
  const { rows } = await query(
    `SELECT r.*, bu.name AS bu_name
     FROM lead_routing_rules r
     JOIN business_units bu ON bu.id = r.business_unit_id
     WHERE r.organization_id = $1
     ORDER BY r.priority ASC, r.created_at ASC`,
    [organizationId]
  );
  return rows;
}

export async function deleteRoutingRule(id) {
  await query(`DELETE FROM lead_routing_rules WHERE id = $1`, [id]);
}

export async function getActiveRoutingRules(organizationId) {
  const { rows } = await query(
    `SELECT * FROM lead_routing_rules
     WHERE organization_id = $1 AND is_active = TRUE
     ORDER BY priority ASC`,
    [organizationId]
  );
  return rows;
}
