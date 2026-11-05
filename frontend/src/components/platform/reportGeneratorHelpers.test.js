import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReportDownloadFilename,
  buildReportGeneratePayload,
} from './reportGeneratorHelpers.js';

test('buildReportGeneratePayload includes org/stage/format/context and date range', () => {
  const payload = buildReportGeneratePayload({
    organization: { id: 'org-1', slug: 'client-a' },
    stage: 'mid',
    format: 'pdf',
    dateFrom: '2026-01-01',
    dateTo: '2026-01-31',
    programmeName: 'Phoenix',
    industry: 'Healthcare',
    changeType: 'Technology',
    programmeTimeline: 'Q1-Q2',
    consultantNotes: 'Watch manager load',
  });

  assert.equal(payload.org_id, 'org-1');
  assert.equal(payload.org_slug, 'client-a');
  assert.equal(payload.stage, 'mid');
  assert.equal(payload.format, 'pdf');
  assert.equal(payload.context.programme_name, 'Phoenix');
  assert.equal(payload.context.change_type, 'Technology');
  assert.match(payload.date_from, /^2026-01-01T00:00:00.000Z$/);
  assert.match(payload.date_to, /^2026-01-31T23:59:59.999Z$/);
});

test('buildReportGeneratePayload normalizes empty change type and omits empty dates', () => {
  const payload = buildReportGeneratePayload({
    organization: { id: null, slug: null },
    stage: 'pre',
    format: 'docx',
    dateFrom: '',
    dateTo: '',
    programmeName: '',
    industry: '',
    changeType: '',
    programmeTimeline: '',
    consultantNotes: '',
  });

  assert.equal(payload.context.change_type, null);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'date_from'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'date_to'), false);
});

test('buildReportDownloadFilename uses org slug and extension fallback rules', () => {
  assert.equal(
    buildReportDownloadFilename({ organization: { slug: 'client-a' }, stage: 'post', format: 'pdf' }),
    'client-a-post.pdf'
  );
  assert.equal(
    buildReportDownloadFilename({ organization: null, stage: 'pre', format: 'docx' }),
    'report-pre.docx'
  );
});

// RED-055: the report history saved every file as "<client>-report" with no
// extension, and a refused download only ever said "Could not download".
test('buildReportDownloadFilename always carries the right extension', async () => {
  const { buildReportDownloadFilename } = await import('./reportGeneratorHelpers.js');
  assert.equal(buildReportDownloadFilename({ organization: { slug: 'acme' }, stage: 'mid', format: 'pdf' }), 'acme-mid.pdf');
  assert.equal(buildReportDownloadFilename({ organization: { slug: 'acme' }, stage: 'pre', format: 'docx' }), 'acme-pre.docx');
  assert.equal(buildReportDownloadFilename({ organization: { slug: 'acme' }, stage: '', format: 'pdf' }), 'acme-report.pdf');
});

test('readDownloadErrorMessage reads the server message out of a blob error body', async () => {
  const { readDownloadErrorMessage } = await import('./reportGeneratorHelpers.js');
  const message = 'This PDF was not generated correctly and cannot be opened. Please regenerate the report.';
  const blobError = { response: { data: new Blob([JSON.stringify({ error: message })], { type: 'application/json' }) } };
  assert.equal(await readDownloadErrorMessage(blobError), message);
  assert.equal(await readDownloadErrorMessage({ response: { data: { error: 'Report has expired' } } }), 'Report has expired');
  assert.equal(await readDownloadErrorMessage({ response: { data: new Blob(['not json']) } }), 'Could not download report.');
  assert.equal(await readDownloadErrorMessage(new Error('network')), 'Could not download report.');
});
