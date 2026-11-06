import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReportRequest } from './reportInput.js';

test('validateReportRequest accepts valid payload', () => {
  const result = validateReportRequest({
    stage: 'mid',
    format: 'pdf',
    date_from: '2026-04-01T00:00:00.000Z',
    date_to: '2026-04-30T23:59:59.999Z',
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.stage, 'mid');
  assert.equal(result.value.format, 'pdf');
  // The report form no longer collects free-text context, so none is passed on.
  assert.equal(Object.prototype.hasOwnProperty.call(result.value, 'context'), false);
});

test('validateReportRequest rejects invalid stage', () => {
  const result = validateReportRequest({ stage: 'during', format: 'docx' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'STAGE_INVALID');
});

