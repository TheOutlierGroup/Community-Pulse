import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeCompletePdf } from './reportGeneration.js';

// A downloaded report showed "We can't open this file" in the browser's
// PDF viewer. soffice killed by the conversion timeout (or crashed/OOM'd)
// still leaves a partial file on disk, and execFileAsync doesn't throw for
// that -- fs.readFile happily returns whatever bytes exist, so a truncated
// PDF sailed straight through as a 'complete', downloadable report.

function validPdfBuffer({ padding = 2000 } = {}) {
  return Buffer.from(`%PDF-1.7\n${'x'.repeat(padding)}\n%%EOF\n`);
}

test('looksLikeCompletePdf accepts a well-formed PDF', () => {
  assert.equal(looksLikeCompletePdf(validPdfBuffer()), true);
});

test('looksLikeCompletePdf rejects a truncated file with no trailer', () => {
  const truncated = validPdfBuffer().subarray(0, 1500);
  assert.equal(looksLikeCompletePdf(truncated), false);
});

test('looksLikeCompletePdf rejects a file missing the PDF header', () => {
  const buffer = Buffer.from(`not a pdf\n${'x'.repeat(2000)}\n%%EOF\n`);
  assert.equal(looksLikeCompletePdf(buffer), false);
});

test('looksLikeCompletePdf rejects an implausibly small file', () => {
  assert.equal(looksLikeCompletePdf(Buffer.from('%PDF-1.7\n%%EOF\n')), false);
});

test('looksLikeCompletePdf rejects non-buffer input', () => {
  assert.equal(looksLikeCompletePdf(null), false);
  assert.equal(looksLikeCompletePdf(undefined), false);
  assert.equal(looksLikeCompletePdf('not a buffer'), false);
});
