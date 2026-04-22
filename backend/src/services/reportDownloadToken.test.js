import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReportDownloadToken,
  verifyReportDownloadToken,
} from './reportDownloadToken.js';

test('download token roundtrip succeeds', () => {
  const token = createReportDownloadToken({
    reportId: 'report-1',
    userId: 'user-1',
    organizationId: 'org-1',
    expiresInSeconds: 300,
  });
  const parsed = verifyReportDownloadToken(token);
  assert.ok(parsed);
  assert.equal(parsed.reportId, 'report-1');
  assert.equal(parsed.userId, 'user-1');
  assert.equal(parsed.organizationId, 'org-1');
});

test('download token rejects tampering', () => {
  const token = createReportDownloadToken({
    reportId: 'report-2',
    userId: 'user-2',
    organizationId: 'org-2',
    expiresInSeconds: 300,
  });
  const tampered = token.replace('report-2', 'report-3');
  const parsed = verifyReportDownloadToken(tampered);
  assert.equal(parsed, null);
});
