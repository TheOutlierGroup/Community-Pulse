import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production' && process.env.DATABASE_SSL !== 'false'
      ? { rejectUnauthorized: false }
      : false,
});

export async function query(text, params) {
  return pool.query(text, params);
}
