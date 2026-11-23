import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Point storage at a temp dir before the module reads STORAGE_PATH.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'org-logo-store-'));
process.env.STORAGE_PATH = tmp;
const { ensureOrgLogoLocal, mirrorOrgLogo, forgetOrgLogo } = await import('./orgLogoStore.js');
const { orgLogoFilePath } = await import('../config/storage.js');

function fakeDb() {
  const rows = new Map();
  const calls = [];
  return {
    rows,
    calls,
    query: async (sql, params) => {
      calls.push(sql.trim().split(/\s+/)[0]);
      if (/^INSERT/i.test(sql.trim())) {
        rows.set(params[0], { content_type: params[1], data: params[2] });
        return { rows: [] };
      }
      if (/^DELETE/i.test(sql.trim())) {
        rows.delete(params[0]);
        return { rows: [] };
      }
      if (/SELECT data/i.test(sql)) {
        const row = rows.get(params[0]);
        return { rows: row ? [{ data: row.data }] : [] };
      }
      if (/SELECT 1/i.test(sql)) return { rows: rows.has(params[0]) ? [{}] : [] };
      return { rows: [] };
    },
  };
}

test('restores a logo from the database when this service disk lacks it', async () => {
  const db = fakeDb();
  const bytes = Buffer.from('png-bytes');
  await mirrorOrgLogo('org-a.png', bytes, db);
  assert.equal(fs.existsSync(orgLogoFilePath('org-a.png')), false);
  const full = await ensureOrgLogoLocal('org-a.png', db);
  assert.ok(full);
  assert.deepEqual(fs.readFileSync(full), bytes);
});

test('backfills a disk-only logo into the database on first read', async () => {
  const db = fakeDb();
  fs.mkdirSync(path.dirname(orgLogoFilePath('org-b.png')), { recursive: true });
  fs.writeFileSync(orgLogoFilePath('org-b.png'), Buffer.from('old-logo'));
  await ensureOrgLogoLocal('org-b.png', db);
  assert.deepEqual(db.rows.get('org-b.png').data, Buffer.from('old-logo'));
});

test('missing everywhere returns null; unsafe names rejected', async () => {
  const db = fakeDb();
  assert.equal(await ensureOrgLogoLocal('nope.png', db), null);
  assert.equal(await ensureOrgLogoLocal('', db), null);
  const full = await ensureOrgLogoLocal('../../etc/passwd', db);
  assert.equal(full, null);
});

test('forget removes the database copy', async () => {
  const db = fakeDb();
  await mirrorOrgLogo('org-c.png', Buffer.from('x'), db);
  await forgetOrgLogo('org-c.png', db);
  assert.equal(db.rows.has('org-c.png'), false);
});
