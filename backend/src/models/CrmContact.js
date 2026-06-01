import pool from '../db.js';

export async function listContacts(organisationId) {
  const { rows } = await pool.query(
    `SELECT * FROM crm_contacts WHERE organisation_id = $1 ORDER BY created_date ASC, contact_id ASC`,
    [organisationId],
  );
  return rows;
}

export async function getContact(contactId, organisationId) {
  const { rows } = await pool.query(
    `SELECT * FROM crm_contacts WHERE contact_id = $1 AND organisation_id = $2`,
    [contactId, organisationId],
  );
  return rows[0] || null;
}

export async function createContact(organisationId, data) {
  const { contact_firstname, contact_lastname, contact_email, contact_phone, contact_role } = data;
  const { rows } = await pool.query(
    `INSERT INTO crm_contacts (contact_firstname, contact_lastname, contact_email, contact_phone, contact_role, organisation_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [contact_firstname, contact_lastname || null, contact_email || null, contact_phone || null, contact_role || null, organisationId],
  );
  // touch parent updated_at
  await pool.query(`UPDATE crm_organisations SET updated_at = NOW() WHERE organisation_id = $1`, [organisationId]);
  return rows[0];
}

export async function updateContact(contactId, organisationId, data) {
  const allowed = ['contact_firstname', 'contact_lastname', 'contact_email', 'contact_phone', 'contact_role'];
  const sets = [];
  const values = [];
  let i = 1;

  for (const key of allowed) {
    if (key in data) {
      sets.push(`${key} = $${i++}`);
      values.push(data[key] ?? null);
    }
  }
  if (sets.length === 0) return getContact(contactId, organisationId);

  sets.push(`updated_at = NOW()`);
  values.push(contactId, organisationId);

  const { rows } = await pool.query(
    `UPDATE crm_contacts SET ${sets.join(', ')}
      WHERE contact_id = $${i++} AND organisation_id = $${i++}
      RETURNING *`,
    values,
  );
  await pool.query(`UPDATE crm_organisations SET updated_at = NOW() WHERE organisation_id = $1`, [organisationId]);
  return rows[0] || null;
}

export async function deleteContact(contactId, organisationId) {
  await pool.query(
    `DELETE FROM crm_contacts WHERE contact_id = $1 AND organisation_id = $2`,
    [contactId, organisationId],
  );
  await pool.query(`UPDATE crm_organisations SET updated_at = NOW() WHERE organisation_id = $1`, [organisationId]);
}

export async function contactBelongsToOrg(organisationId, contactId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM crm_contacts WHERE contact_id = $1 AND organisation_id = $2`,
    [contactId, organisationId],
  );
  return rows.length > 0;
}
