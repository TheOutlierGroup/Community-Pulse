import { query } from '../config/database.js';

export const OPPORTUNITY_STAGES = ['New', 'Qualified', 'Meeting', 'Proposal'];

export async function getOrCreateOpportunityForOrganisation(organisationId) {
  const { rows } = await query(
    `SELECT * FROM crm_opportunities WHERE organisation_id = $1`,
    [organisationId],
  );
  let opportunity = rows[0];
  if (!opportunity) {
    const inserted = await query(
      `INSERT INTO crm_opportunities (organisation_id) VALUES ($1)
       ON CONFLICT (organisation_id) DO UPDATE SET organisation_id = EXCLUDED.organisation_id
       RETURNING *`,
      [organisationId],
    );
    opportunity = inserted.rows[0];
  }
  // Every stage should have a checkpoint row so the sales-timeline UI can
  // always render all four columns, even before anyone has entered figures.
  await query(
    `INSERT INTO crm_opportunity_checkpoints (opportunity_id, stage)
     SELECT $1, s FROM unnest($2::text[]) AS s
     ON CONFLICT (opportunity_id, stage) DO NOTHING`,
    [opportunity.opportunity_id, OPPORTUNITY_STAGES],
  );
  return opportunity;
}

export async function getOpportunityForOrganisation(organisationId) {
  const { rows } = await query(
    `SELECT * FROM crm_opportunities WHERE organisation_id = $1`,
    [organisationId],
  );
  return rows[0] || null;
}

export async function updateOpportunity(opportunityId, { currentStage, progressPct, summary }) {
  const sets = [];
  const values = [];
  let i = 1;
  if (currentStage !== undefined) {
    sets.push(`current_stage = $${i++}`);
    values.push(OPPORTUNITY_STAGES.includes(currentStage) ? currentStage : 'New');
  }
  if (progressPct !== undefined) {
    const pct = Math.max(0, Math.min(100, Number.parseInt(progressPct, 10) || 0));
    sets.push(`progress_pct = $${i++}`);
    values.push(pct);
  }
  if (summary !== undefined) {
    sets.push(`summary = $${i++}`);
    values.push(summary || null);
  }
  if (sets.length === 0) {
    const { rows } = await query(`SELECT * FROM crm_opportunities WHERE opportunity_id = $${i}`, [opportunityId]);
    return rows[0] || null;
  }
  sets.push('updated_at = NOW()');
  values.push(opportunityId);
  const { rows } = await query(
    `UPDATE crm_opportunities SET ${sets.join(', ')} WHERE opportunity_id = $${i} RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function listCheckpoints(opportunityId) {
  const { rows } = await query(
    `SELECT * FROM crm_opportunity_checkpoints WHERE opportunity_id = $1`,
    [opportunityId],
  );
  return rows.sort((a, b) => OPPORTUNITY_STAGES.indexOf(a.stage) - OPPORTUNITY_STAGES.indexOf(b.stage));
}

export async function upsertCheckpoint(opportunityId, stage, { expectedValue, financialGain, targetDate, notes }) {
  if (!OPPORTUNITY_STAGES.includes(stage)) throw new Error('Invalid stage');
  const { rows } = await query(
    `INSERT INTO crm_opportunity_checkpoints (opportunity_id, stage, expected_value, financial_gain, target_date, notes)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (opportunity_id, stage) DO UPDATE SET
       expected_value = EXCLUDED.expected_value,
       financial_gain = EXCLUDED.financial_gain,
       target_date = EXCLUDED.target_date,
       notes = EXCLUDED.notes,
       updated_at = NOW()
     RETURNING *`,
    [
      opportunityId,
      stage,
      expectedValue === '' || expectedValue == null ? null : expectedValue,
      financialGain === '' || financialGain == null ? null : financialGain,
      targetDate || null,
      notes || null,
    ],
  );
  return rows[0];
}

export async function listFiles(opportunityId) {
  const { rows } = await query(
    `SELECT f.*, u.first_name, u.last_name, u.email
       FROM crm_opportunity_files f
       LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.opportunity_id = $1
      ORDER BY f.created_at DESC`,
    [opportunityId],
  );
  return rows;
}

export async function createFileRecord(opportunityId, { filename, originalName, sizeBytes, contentType, uploadedBy }) {
  const { rows } = await query(
    `INSERT INTO crm_opportunity_files (opportunity_id, filename, original_name, size_bytes, content_type, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [opportunityId, filename, originalName, sizeBytes || 0, contentType || null, uploadedBy || null],
  );
  return rows[0];
}

export async function getFile(opportunityId, fileId) {
  const { rows } = await query(
    `SELECT * FROM crm_opportunity_files WHERE id = $1 AND opportunity_id = $2`,
    [fileId, opportunityId],
  );
  return rows[0] || null;
}

export async function deleteFileRecord(opportunityId, fileId) {
  await query(
    `DELETE FROM crm_opportunity_files WHERE id = $1 AND opportunity_id = $2`,
    [fileId, opportunityId],
  );
}
