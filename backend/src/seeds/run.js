import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { pool } from '../config/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'hello@lukeford.dev';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Connor!7';

async function seed() {
  const client = await pool.connect();
  try {
    const existing = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [ADMIN_EMAIL]
    );
    if (existing.rows.length > 0) {
      console.log('Seed skipped: admin user already exists.');
      return;
    }

    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);

    await client.query('BEGIN');
    const org = await client.query(
      `INSERT INTO organizations (name, settings) VALUES ($1, $2) RETURNING id`,
      ['Default Organization', JSON.stringify({})]
    );
    const orgId = org.rows[0].id;

    await client.query(
      `INSERT INTO users (email, password_hash, role, organization_id)
       VALUES ($1, $2, 'admin', $3)`,
      [ADMIN_EMAIL, hash, orgId]
    );
    await client.query('COMMIT');
    console.log(`Seeded admin: ${ADMIN_EMAIL}`);
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
