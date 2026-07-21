import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, mapImportRows, looksLikeSource } from './contactImportCsv.js';

test('parseCsv handles quoted fields, embedded commas, newlines and escaped quotes', () => {
  const csv = [
    'First name,Last name,Notes',
    'Kay,Clancy,"Chief, People Officer"',
    '"Le""an""ne",Hopkins,"line1\nline2"',
  ].join('\n');
  const { headers, rows } = parseCsv(csv);
  assert.deepEqual(headers, ['First name', 'Last name', 'Notes']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Notes, 'Chief, People Officer');
  assert.equal(rows[1]['First name'], 'Le"an"ne');
  assert.equal(rows[1].Notes, 'line1\nline2');
});

test('parseCsv strips BOM and skips fully-blank rows', () => {
  const csv = '﻿First name,Email\nA,a@x.com\n,\nB,b@x.com\n';
  const { rows } = parseCsv(csv);
  assert.deepEqual(rows.map((r) => r['First name']), ['A', 'B']);
});

test('mapImportRows maps LinkedIn columns and prefers Public URL over Best URL', () => {
  const parsed = parseCsv([
    'Linkedin Public Url,Best LinkedIn URL,First name,Last name,Company,Position,Email',
    'https://www.linkedin.com/in/kay,https://www.linkedin.com/in/kay-alt,Kay,Clancy,WISE,CPO,kay@wise.com',
    ',https://www.linkedin.com/in/fallback,No,Public,Acme,Mgr,n@acme.com',
  ].join('\n'));
  const rows = mapImportRows(parsed, 'linkedin');
  assert.equal(rows[0].linkedin_url, 'https://www.linkedin.com/in/kay');
  assert.equal(rows[0].position, 'CPO');
  assert.equal(rows[1].linkedin_url, 'https://www.linkedin.com/in/fallback'); // fell back to Best
});

test('mapImportRows maps Firmable columns including the parenthesised header', () => {
  const parsed = parseCsv([
    'First name,Last name,LinkedIn,Department,Employee count range (Global),Primary mobile DNC,List',
    'Barry,Bloch,https://www.linkedin.com/in/barrybloch,Human Resources,"1,001 - 5,000",false,PEOPLE',
  ].join('\n'));
  const rows = mapImportRows(parsed, 'firmable');
  assert.equal(rows[0].department, 'Human Resources');
  assert.equal(rows[0].employee_count_range, '1,001 - 5,000');
  assert.equal(rows[0].dnc_mobile, 'false');
  assert.equal(rows[0].list, 'PEOPLE');
});

test('mapImportRows is case/whitespace tolerant on headers', () => {
  const parsed = parseCsv('  FIRST NAME , linkedin \nSam,https://linkedin.com/in/sam');
  const rows = mapImportRows(parsed, 'firmable');
  assert.equal(rows[0].first_name, 'Sam');
  assert.equal(rows[0].linkedin_url, 'https://linkedin.com/in/sam');
});

test('looksLikeSource detects the wrong file for a source', () => {
  const li = parseCsv('Linkedin Public Url,First name\nx,Kay');
  const fb = parseCsv('LinkedIn,First name,List\nx,Kay,PEOPLE');
  assert.equal(looksLikeSource(li, 'linkedin'), true);
  assert.equal(looksLikeSource(li, 'firmable'), false); // no 'LinkedIn' column
  assert.equal(looksLikeSource(fb, 'firmable'), true);
});
