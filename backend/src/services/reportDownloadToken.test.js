import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  createReportDownloadToken,
  verifyReportDownloadToken,
} from './reportDownloadToken.js';
import { reportDownloadSecret } from './reportConfig.js';

// PT-10: these two original cases signed tokens with no secret
// configured at all — they passed because the old module-load fallback
// quietly minted a random per-process key. That is precisely the
// behaviour being removed, so the suite now sets a secret explicitly,
// the way a deployed environment must.
const TEST_SECRET = 'report-download-test-secret-0123456789';

function withEnv({ report, jwt }, fn) {
  const priorReport = process.env.REPORT_DOWNLOAD_SECRET;
  const priorJwt = process.env.JWT_SECRET;
  if (report === undefined) delete process.env.REPORT_DOWNLOAD_SECRET;
  else process.env.REPORT_DOWNLOAD_SECRET = report;
  if (jwt === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = jwt;
  try {
    return fn();
  } finally {
    if (priorReport === undefined) delete process.env.REPORT_DOWNLOAD_SECRET;
    else process.env.REPORT_DOWNLOAD_SECRET = priorReport;
    if (priorJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = priorJwt;
  }
}

const withSecret = (fn) => withEnv({ report: TEST_SECRET }, fn);
const args = { reportId: 'report-1', userId: 'user-1', organizationId: 'org-1' };

test('download token roundtrip succeeds', () => {
  withSecret(() => {
    const token = createReportDownloadToken({ ...args, expiresInSeconds: 300 });
    const parsed = verifyReportDownloadToken(token);
    assert.ok(parsed);
    assert.equal(parsed.reportId, 'report-1');
    assert.equal(parsed.userId, 'user-1');
    assert.equal(parsed.organizationId, 'org-1');
  });
});

test('download token rejects tampering', () => {
  withSecret(() => {
    const token = createReportDownloadToken({
      reportId: 'report-2',
      userId: 'user-2',
      organizationId: 'org-2',
      expiresInSeconds: 300,
    });
    const tampered = token.replace('report-2', 'report-3');
    assert.equal(verifyReportDownloadToken(tampered), null);
  });
});

// ── PT-09: constant-time signature comparison ────────────────────────

test('PT-09: a forged signature is refused', () => {
  withSecret(() => {
    const parts = createReportDownloadToken(args).split('.');
    parts[4] = crypto.randomBytes(32).toString('base64url');
    assert.equal(verifyReportDownloadToken(parts.join('.')), null);
  });
});

test('PT-09: a signature of the wrong length is refused, not thrown on', () => {
  // timingSafeEqual throws on a length mismatch, so the length check has
  // to come first — otherwise a truncated signature 500s instead of
  // failing closed.
  withSecret(() => {
    const parts = createReportDownloadToken(args).split('.');
    parts[4] = 'short';
    const forged = parts.join('.');
    assert.doesNotThrow(() => verifyReportDownloadToken(forged));
    assert.equal(verifyReportDownloadToken(forged), null);
  });
});

test('PT-09: a token signed with a different secret is refused', () => {
  const token = withSecret(() => createReportDownloadToken(args));
  withEnv({ report: 'a-completely-different-secret-value' }, () => {
    assert.equal(verifyReportDownloadToken(token), null);
  });
});

test('createReportDownloadToken floors the TTL rather than minting a dead token', () => {
  // Math.max(60, ...) means a negative TTL cannot produce an
  // already-expired link — worth pinning, since it is why the expiry
  // case below has to forge its token by hand.
  withSecret(() => {
    const parsed = verifyReportDownloadToken(
      createReportDownloadToken({ ...args, expiresInSeconds: -10 })
    );
    assert.ok(parsed, 'a negative TTL is clamped, not honoured');
    assert.ok(parsed.expiresAt > Math.floor(Date.now() / 1000));
  });
});

test('PT-09: a correctly-signed but expired token is refused', () => {
  // Signed with the real secret so this exercises the expiry check on its
  // own, independently of signature verification.
  withSecret(() => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const payload = `${args.reportId}.${args.userId}.${args.organizationId}.${past}`;
    const sig = crypto
      .createHmac('sha256', reportDownloadSecret())
      .update(payload)
      .digest('base64url');
    assert.equal(verifyReportDownloadToken(`${payload}.${sig}`), null);
  });
});

// ── PT-10: no silent random-secret fallback ──────────────────────────

test('PT-10: a missing secret throws instead of minting a random one', () => {
  // The old fallback produced a per-process key: tokens that verified
  // nowhere else, differed between the two web services, and rotated on
  // every restart — surfacing only as "Invalid or expired download
  // token" on links that should have worked.
  withEnv({}, () => {
    assert.throws(() => reportDownloadSecret(), /must be set/i);
    assert.throws(() => createReportDownloadToken(args), /must be set/i);
  });
});

test('PT-10: JWT_SECRET remains a supported fallback', () => {
  withEnv({ jwt: 'jwt-fallback-secret-jwt-fallback-0123' }, () => {
    assert.equal(reportDownloadSecret(), 'jwt-fallback-secret-jwt-fallback-0123');
    assert.ok(verifyReportDownloadToken(createReportDownloadToken(args)));
  });
});
