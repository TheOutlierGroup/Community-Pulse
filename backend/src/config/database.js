import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const { Pool } = pg;

function buildSslConfig() {
  if (process.env.DATABASE_SSL === 'false') return false;
  const shouldUseSsl = process.env.NODE_ENV === 'production' || process.env.DATABASE_SSL === 'true';
  if (!shouldUseSsl) return false;

  const caPath = process.env.DATABASE_CA_CERT_PATH;
  if (caPath && fs.existsSync(caPath)) {
    return {
      rejectUnauthorized: true,
      ca: fs.readFileSync(caPath, 'utf8'),
    };
  }

  if (process.env.NODE_ENV === 'production' && process.env.DATABASE_SSL_ALLOW_SELF_SIGNED === 'true') {
    return { rejectUnauthorized: false };
  }

  return { rejectUnauthorized: true };
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: buildSslConfig(),
});

export async function query(text, params) {
  return pool.query(text, params);
}
