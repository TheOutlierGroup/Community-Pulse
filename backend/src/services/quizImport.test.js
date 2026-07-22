import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubmittedAt } from './quizImport.js';

test('parses ISO-ish "YYYY-MM-DD HH:mm:ss" as explicit UTC', () => {
  assert.equal(parseSubmittedAt('2026-07-20 21:12:24'), '2026-07-20T21:12:24Z');
});

test('parses D/M/Y "17/07/2026 5:33" (24h, no seconds)', () => {
  assert.equal(parseSubmittedAt('17/07/2026 5:33'), '2026-07-17T05:33:00Z');
});

test('parses D/M/Y with seconds', () => {
  assert.equal(parseSubmittedAt('21/07/2026 0:18:09'), '2026-07-21T00:18:09Z');
});

test('parses date-only D/M/Y', () => {
  assert.equal(parseSubmittedAt('01/12/2026'), '2026-12-01T00:00:00Z');
});

test('returns null for blank or unparseable', () => {
  assert.equal(parseSubmittedAt(''), null);
  assert.equal(parseSubmittedAt('   '), null);
  assert.equal(parseSubmittedAt('not a date'), null);
  assert.equal(parseSubmittedAt(null), null);
});
