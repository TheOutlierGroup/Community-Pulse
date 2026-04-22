import { query } from '../config/database.js';

function normalizeSlug(value) {
  const base = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || null;
}

export async function createOrganization(
  name,
  settings = {},
  kind = 'client',
  clientStatus = kind === 'client' ? 'prospect-new' : 'active'
) {
  const slug = normalizeSlug(name);
  const { rows } = await query(
    `INSERT INTO organizations (name, slug, settings, kind, client_status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name, slug, JSON.stringify(settings), kind, clientStatus]
  );
  return rows[0];
}

export async function getOrganization(id) {
  const { rows } = await query(`SELECT * FROM organizations WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function getOrganizationBySlug(slug) {
  const normalized = normalizeSlug(slug);
  if (!normalized) return null;
  const { rows } = await query(`SELECT * FROM organizations WHERE lower(slug) = lower($1)`, [normalized]);
  return rows[0] || null;
}

export async function getFirstOrganizationByKind(kind) {
  const { rows } = await query(
    `SELECT * FROM organizations WHERE kind = $1 ORDER BY created_at ASC LIMIT 1`,
    [kind]
  );
  return rows[0] || null;
}

export async function listOrganizationsByKind(kind, { limit, offset } = {}) {
  const cappedLimit =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 200;
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const { rows } = await query(
    `SELECT id, name, slug, kind, settings, created_at, company_logo_filename, client_status,
            hierarchy_levels, report_contact
     FROM organizations
     WHERE kind = $1
     ORDER BY created_at ASC
     LIMIT $2 OFFSET $3`,
    [kind, cappedLimit, safeOffset]
  );
  return rows;
}

export async function listClientOrganizationsByIds(ids, { limit, offset } = {}) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const cappedLimit =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 500;
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const { rows } = await query(
    `SELECT id, name, slug, kind, settings, created_at, company_logo_filename, client_status,
            hierarchy_levels, report_contact
     FROM organizations
     WHERE kind = 'client' AND id = ANY($1::uuid[])
     ORDER BY created_at ASC
     LIMIT $2 OFFSET $3`,
    [ids, cappedLimit, safeOffset]
  );
  return rows;
}

export async function setCompanyLogoFilename(id, filename) {
  const { rows } = await query(
    `UPDATE organizations SET company_logo_filename = $2 WHERE id = $1 AND kind = 'client' RETURNING *`,
    [id, filename]
  );
  return rows[0] || null;
}

export async function clearCompanyLogoFilename(id) {
  const org = await getOrganization(id);
  const prev = org?.company_logo_filename || null;
  await query(`UPDATE organizations SET company_logo_filename = NULL WHERE id = $1`, [id]);
  return prev;
}

export async function updateOrganizationClient(id, { name, settings, clientStatus } = {}) {
  const org = await getOrganization(id);
  if (!org || org.kind !== 'client') return null;
  const nextName = name !== undefined ? name : org.name;
  const nextSlug = name !== undefined ? normalizeSlug(name) : org.slug;
  const nextClientStatus = clientStatus !== undefined ? clientStatus : org.client_status;
  const base =
    org.settings && typeof org.settings === 'object' ? org.settings : {};
  let nextSettings = base;
  if (settings !== undefined && typeof settings === 'object') {
    nextSettings = { ...base, ...settings };
  }
  const { rows } = await query(
    `UPDATE organizations
     SET name = $2, slug = $3, settings = $4::jsonb, client_status = $5
     WHERE id = $1 AND kind = 'client'
     RETURNING *`,
    [id, nextName, nextSlug, JSON.stringify(nextSettings), nextClientStatus]
  );
  return rows[0] || null;
}

export async function updateOrganizationSettings(id, settings) {
  const org = await getOrganization(id);
  if (!org) return null;
  const base =
    org.settings && typeof org.settings === 'object' && !Array.isArray(org.settings)
      ? org.settings
      : {};
  const patch =
    settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  const nextSettings = { ...base, ...patch };
  const { rows } = await query(
    `UPDATE organizations SET settings = $2::jsonb WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(nextSettings)]
  );
  return rows[0] || null;
}
