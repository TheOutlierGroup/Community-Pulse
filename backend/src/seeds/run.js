import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { pool } from '../config/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'hello@lukeford.dev';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Connor!7';
const ORG_NAME = process.env.SEED_ORG_NAME || 'Outlier';

async function ensureBootstrapOrgIsPlatform(client) {
  const { rows } = await client.query(
    `SELECT u.organization_id, o.kind
     FROM users u
     JOIN organizations o ON o.id = u.organization_id
     WHERE LOWER(u.email) = LOWER($1)`,
    [ADMIN_EMAIL]
  );
  const row = rows[0];
  if (!row) return;
  if (row.kind === 'platform') return;
  await client.query(
    `UPDATE organizations
     SET kind = 'platform',
         name = CASE
           WHEN LOWER(TRIM(name)) = 'default organization' THEN $2
           ELSE name
         END
     WHERE id = $1`,
    [row.organization_id, ORG_NAME]
  );
  console.log(
    `Bootstrap admin: organization ${row.organization_id} is now platform (${ADMIN_EMAIL}).`
  );
}

async function seed() {
  const client = await pool.connect();
  try {
    await ensureBootstrapOrgIsPlatform(client);

    const existing = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [
      ADMIN_EMAIL,
    ]);
    if (existing.rows.length > 0) {
      console.log('Seed skipped: admin user already exists.');
      return;
    }

    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);

    await client.query('BEGIN');
    const org = await client.query(
      `INSERT INTO organizations (name, settings, kind) VALUES ($1, $2, 'platform') RETURNING id`,
      [ORG_NAME, JSON.stringify({})]
    );
    const orgId = org.rows[0].id;

    await client.query(
      `INSERT INTO users (email, password_hash, role, organization_id)
       VALUES ($1, $2, 'admin', $3)`,
      [ADMIN_EMAIL, hash, orgId]
    );
    await client.query('COMMIT');
    console.log(`Seeded platform admin: ${ADMIN_EMAIL} (org: ${ORG_NAME})`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
