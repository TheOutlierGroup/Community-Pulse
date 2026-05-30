import { query } from '../config/database.js';

export async function createAccount(organizationId, { name, website, industry, address, notes, customFields = {}, createdBy = null }) {
  const { rows } = await query(
    `INSERT INTO accounts (organization_id, name, website, industry, address, notes, custom_fields, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     RETURNING *`,
    [organizationId, String(name).trim(), website || null, industry || null, address || null, notes || null, JSON.stringify(customFields), createdBy]
  );
  return rows[0];
}

export async function getAccount(id) {
  const { rows } = await query(`SELECT * FROM accounts WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function listAccounts(organizationId, { search, limit = 100, offset = 0 } = {}) {
  const cap = Math.min(Number(limit) || 100, 500);
  const off = Math.max(Number(offset) || 0, 0);
  if (search) {
    const { rows } = await query(
      `SELECT * FROM accounts
       WHERE organization_id = $1 AND name ILIKE $2
       ORDER BY name ASC LIMIT $3 OFFSET $4`,
      [organizationId, `%${search}%`, cap, off]
    );
    return rows;
  }
  const { rows } = await query(
    `SELECT * FROM accounts WHERE organization_id = $1 ORDER BY name ASC LIMIT $2 OFFSET $3`,
    [organizationId, cap, off]
  );
  return rows;
}

export async function updateAccount(id, { name, website, industry, address, notes, customFields } = {}) {
  const acc = await getAccount(id);
  if (!acc) return null;
  const { rows } = await query(
    `UPDATE accounts
     SET name          = COALESCE($2, name),
         website       = COALESCE($3, website),
         industry      = COALESCE($4, industry),
         address       = COALESCE($5, address),
         notes         = COALESCE($6, notes),
         custom_fields = CASE WHEN $7::text IS NOT NULL THEN $7::jsonb ELSE custom_fields END,
         updated_at    = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, name || null, website !== undefined ? website : null, industry !== undefined ? industry : null, address !== undefined ? address : null, notes !== undefined ? notes : null, customFields != null ? JSON.stringify(customFields) : null]
  );
  return rows[0] || null;
}

export async function deleteAccount(id) {
  const acc = await getAccount(id);
  if (!acc) return null;
  await query(`DELETE FROM accounts WHERE id = $1`, [id]);
  return acc;
}

export async function accountBelongsToOrg(accountId, organizationId) {
  const { rows } = await query(
    `SELECT 1 FROM accounts WHERE id = $1 AND organization_id = $2`,
    [accountId, organizationId]
  );
  return rows.length > 0;
}

// ── Contacts ─────────────────────────────────────────────────────────────────

export async function createContact(accountId, { firstName, lastName, email, phone, jobTitle, isPrimary = false, notes, customFields = {}, createdBy = null }) {
  const { rows } = await query(
    `INSERT INTO contacts (account_id, first_name, last_name, email, phone, job_title, is_primary, notes, custom_fields, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
     RETURNING *`,
    [accountId, String(firstName).trim(), String(lastName).trim(), email || null, phone || null, jobTitle || null, Boolean(isPrimary), notes || null, JSON.stringify(customFields), createdBy]
  );
  return rows[0];
}

export async function getContact(id) {
  const { rows } = await query(`SELECT * FROM contacts WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function listContacts(accountId) {
  const { rows } = await query(
    `SELECT * FROM contacts WHERE account_id = $1 ORDER BY is_primary DESC, first_name ASC, last_name ASC`,
    [accountId]
  );
  return rows;
}

export async function updateContact(id, { firstName, lastName, email, phone, jobTitle, isPrimary, notes, customFields } = {}) {
  const contact = await getContact(id);
  if (!contact) return null;
  const { rows } = await query(
    `UPDATE contacts
     SET first_name    = COALESCE($2, first_name),
         last_name     = COALESCE($3, last_name),
         email         = COALESCE($4, email),
         phone         = COALESCE($5, phone),
         job_title     = COALESCE($6, job_title),
         is_primary    = COALESCE($7, is_primary),
         notes         = COALESCE($8, notes),
         custom_fields = CASE WHEN $9::text IS NOT NULL THEN $9::jsonb ELSE custom_fields END,
         updated_at    = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, firstName || null, lastName || null, email !== undefined ? email : null, phone !== undefined ? phone : null, jobTitle !== undefined ? jobTitle : null, isPrimary != null ? Boolean(isPrimary) : null, notes !== undefined ? notes : null, customFields != null ? JSON.stringify(customFields) : null]
  );
  return rows[0] || null;
}

export async function deleteContact(id) {
  const contact = await getContact(id);
  if (!contact) return null;
  await query(`DELETE FROM contacts WHERE id = $1`, [id]);
  return contact;
}
