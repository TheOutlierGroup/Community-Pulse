import crypto from 'crypto';
import { reportDownloadSecret, REPORT_DOWNLOAD_TTL_SECONDS } from './reportConfig.js';

function signPayload(payload) {
  return crypto
    .createHmac('sha256', reportDownloadSecret())
    .update(payload)
    .digest('base64url');
}

/**
 * PT-09: constant-time signature comparison.
 *
 * `sig !== expected` short-circuits at the first differing byte, which
 * leaks how much of a candidate signature was correct. Forging an HMAC
 * that way over HTTP is not realistic — and this route also requires an
 * authenticated session and re-checks org access — but internalMaintenance.js
 * already does this correctly with timingSafeEqual, so the inconsistency
 * was the real defect: it invites the next comparison to be written the
 * unsafe way.
 *
 * Length is compared first because timingSafeEqual throws on a mismatch.
 * That is not a leak worth worrying about: the signature is a fixed-width
 * SHA-256 digest, so its length is public by construction.
 */
function signaturesMatch(candidate, expected) {
  const a = Buffer.from(String(candidate || ''), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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
  if (!signaturesMatch(sig, expected)) return null;
  const expiresAt = Number.parseInt(expiresAtRaw, 10);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;
  return { reportId, userId, organizationId, expiresAt };
}
