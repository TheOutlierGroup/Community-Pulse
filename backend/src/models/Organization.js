import { query } from '../config/database.js';

export async function createOrganization(name, settings = {}) {
  const { rows } = await query(
    `INSERT INTO organizations (name, settings) VALUES ($1, $2) RETURNING *`,
    [name, JSON.stringify(settings)]
  );
  return rows[0];
}

export async function getOrganization(id) {
  const { rows } = await query(`SELECT * FROM organizations WHERE id = $1`, [id]);
  return rows[0] || null;
}
