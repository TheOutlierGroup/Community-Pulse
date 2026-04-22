import crypto from 'crypto';
import { REPORT_DOWNLOAD_SECRET, REPORT_DOWNLOAD_TTL_SECONDS } from './reportConfig.js';

function signPayload(payload) {
  return crypto
    .createHmac('sha256', REPORT_DOWNLOAD_SECRET)
    .update(payload)
    .digest('base64url');
}

export function createReportDownloadToken({ reportId, userId, organizationId, expiresInSeconds = REPORT_DOWNLOAD_TTL_SECONDS }) {
  const expiresAt = Math.floor(Date.now() / 1000) + Math.max(60, Number(expiresInSeconds) || REPORT_DOWNLOAD_TTL_SECONDS);
  const payload = `${reportId}.${userId}.${organizationId}.${expiresAt}`;
  const sig = signPayload(payload);
  return `${payload}.${sig}`;
}

export function verifyReportDownloadToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 5) return null;
  const [reportId, userId, organizationId, expiresAtRaw, sig] = parts;
  const payload = `${reportId}.${userId}.${organizationId}.${expiresAtRaw}`;
  const expected = signPayload(payload);
  if (sig !== expected) return null;
  const expiresAt = Number.parseInt(expiresAtRaw, 10);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;
  return { reportId, userId, organizationId, expiresAt };
}
