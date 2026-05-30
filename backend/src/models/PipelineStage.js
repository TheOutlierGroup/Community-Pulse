import { query } from '../config/database.js';

export async function createStage(businessUnitId, { name, position, isWon = false, isLost = false }) {
  const { rows } = await query(
    `INSERT INTO pipeline_stages (business_unit_id, name, position, is_won, is_lost)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [businessUnitId, String(name).trim(), Number(position), Boolean(isWon), Boolean(isLost)]
  );
  return rows[0];
}

export async function getStage(id) {
  const { rows } = await query(`SELECT * FROM pipeline_stages WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function listStages(businessUnitId) {
  const { rows } = await query(
    `SELECT * FROM pipeline_stages WHERE business_unit_id = $1 ORDER BY position ASC`,
    [businessUnitId]
  );
  return rows;
}

export async function updateStage(id, { name, position, isWon, isLost } = {}) {
  const { rows } = await query(
    `UPDATE pipeline_stages
     SET name       = COALESCE($2, name),
         position   = COALESCE($3, position),
         is_won     = COALESCE($4, is_won),
         is_lost    = COALESCE($5, is_lost),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, name || null, position != null ? Number(position) : null, isWon != null ? Boolean(isWon) : null, isLost != null ? Boolean(isLost) : null]
  );
  return rows[0] || null;
}

export async function deleteStage(id) {
  const stage = await getStage(id);
  if (!stage) return null;
  await query(`DELETE FROM pipeline_stages WHERE id = $1`, [id]);
  return stage;
}

export async function stageBelongsToBusinessUnit(stageId, businessUnitId) {
  const { rows } = await query(
    `SELECT 1 FROM pipeline_stages WHERE id = $1 AND business_unit_id = $2`,
    [stageId, businessUnitId]
  );
  return rows.length > 0;
}

export async function getFirstStageForBu(businessUnitId) {
  const { rows } = await query(
    `SELECT * FROM pipeline_stages WHERE business_unit_id = $1 ORDER BY position ASC LIMIT 1`,
    [businessUnitId]
  );
  return rows[0] || null;
}
