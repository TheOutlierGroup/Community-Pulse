import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeContext, validateReportRequest } from './reportInput.js';

test('validateReportRequest accepts valid payload', () => {
  const result = validateReportRequest({
    stage: 'mid',
    format: 'pdf',
    date_from: '2026-04-01T00:00:00.000Z',
    date_to: '2026-04-30T23:59:59.999Z',
    context: { programme_name: 'Revamp' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.stage, 'mid');
  assert.equal(result.value.format, 'pdf');
});

test('validateReportRequest rejects invalid stage', () => {
  const result = validateReportRequest({ stage: 'during', format: 'docx' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'STAGE_INVALID');
});

test('sanitizeContext trims and caps text', () => {
  const context = sanitizeContext({
    programme_name: ` ${'A'.repeat(150)} `,
    consultant_notes: '  note  ',
    change_type: 'BadValue',
  });
  assert.equal(context.programme_name.length, 120);
  assert.equal(context.consultant_notes, 'note');
  assert.equal(context.change_type, 'Other');
});
