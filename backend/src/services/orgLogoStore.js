import fs from 'fs';
import path from 'path';
import { query as dbQuery } from '../config/database.js';
import { ensureStorageDirs, orgLogoFilePath } from '../config/storage.js';

/**
 * Organisation logos live on each web service's own disk (STORAGE_PATH).
 * The CRM and Rhythm Engine services have separate disks on Render, so a
 * logo uploaded through one was a 404 on the other: Event mode surveys and
 * dashboards on the Rhythm Engine host showed a broken image.
 *
 * This mirrors every logo into the shared database (stored_org_logos) and,
 * when a service is asked for a logo it does not have on disk, restores it
 * from the database into the local disk first. Callers keep using file
 * paths exactly as before; they just await ensureOrgLogoLocal() first.
 *
 * Logos uploaded before this existed are copied into the database the
 * first time the service that holds them reads them (no re-upload needed).
 */

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const mirroredThisProcess = new Set();

function safeLogoName(filename) {
  const base = path.basename(String(filename || '').trim());
  if (!base || base === '.' || base === '..') return null;
  return base;
}

function contentTypeFor(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/png';
}

function localPathFor(name) {
  const full = path.resolve(orgLogoFilePath(name));
  const { orgLogosDir } = ensureStorageDirs();
  const rel = path.relative(path.resolve(orgLogosDir), full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return full;
}

/** Copy a logo's bytes into the database (after it is written to disk). */
export async function mirrorOrgLogo(filename, buffer, { query = dbQuery } = {}) {
  const name = safeLogoName(filename);
  if (!name || !buffer || !buffer.length || buffer.length > MAX_LOGO_BYTES) return false;
  try {
    await query(
      `INSERT INTO stored_org_logos (filename, content_type, data, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (filename) DO UPDATE SET content_type = EXCLUDED.content_type, data = EXCLUDED.data, updated_at = NOW()`,
      [name, contentTypeFor(name), buffer]
    );
    mirroredThisProcess.add(name);
    return true;
  } catch (error) {
    console.error('Could not mirror organisation logo to the database:', error.message);
    return false;
  }
}

/** Remove a logo's database copy (after it is unlinked from disk). */
export async function forgetOrgLogo(filename, { query = dbQuery } = {}) {
  const name = safeLogoName(filename);
  if (!name) return;
  mirroredThisProcess.delete(name);
  try {
    await query('DELETE FROM stored_org_logos WHERE filename = $1', [name]);
  } catch (error) {
    console.error('Could not remove organisation logo from the database:', error.message);
  }
}

/**
 * Make sure the logo exists on this service's disk, restoring it from the
 * database when needed. Returns the absolute local path, or null when the
 * logo exists nowhere.
 */
export async function ensureOrgLogoLocal(filename, { query = dbQuery } = {}) {
  const name = safeLogoName(filename);
  if (!name) return null;
  const full = localPathFor(name);
  if (!full) return null;

  if (fs.existsSync(full)) {
    // Backfill logos uploaded before mirroring existed, once per process.
    if (!mirroredThisProcess.has(name)) {
      mirroredThisProcess.add(name);
      try {
        const { rows } = await query('SELECT 1 FROM stored_org_logos WHERE filename = $1', [name]);
        if (!rows.length) await mirrorOrgLogo(name, await fs.promises.readFile(full), { query });
      } catch (error) {
        console.error('Could not backfill organisation logo:', error.message);
      }
    }
    return full;
  }

  try {
    const { rows } = await query('SELECT data FROM stored_org_logos WHERE filename = $1', [name]);
    const data = rows[0]?.data;
    if (!data || !data.length) return null;
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, data);
    mirroredThisProcess.add(name);
    return full;
  } catch (error) {
    console.error('Could not restore organisation logo from the database:', error.message);
    return null;
  }
}

export { contentTypeFor as orgLogoContentType };
