import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { pool } from '../config/database.js';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_LOCK_KEY_1 = 842317;
const MIGRATION_LOCK_KEY_2 = 119904;

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function appliedMigrations(client) {
  const { rows } = await client.query('SELECT name FROM schema_migrations ORDER BY name');
  return new Set(rows.map((r) => r.name));
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [MIGRATION_LOCK_KEY_1, MIGRATION_LOCK_KEY_2]);
    await ensureMigrationsTable(client);
    const applied = await appliedMigrations(client);
    const files = fs
      .readdirSync(__dirname)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
          [file]
        );
        await client.query('COMMIT');
        console.log(`Migration applied: ${file}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
    console.log('Migrations complete.');
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [MIGRATION_LOCK_KEY_1, MIGRATION_LOCK_KEY_2]);
    } catch {
      // Connection-level failures auto-release advisory locks; avoid masking prior migration errors.
    }
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
