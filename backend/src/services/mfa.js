import crypto from 'crypto';
import QRCode from 'qrcode';

const DEFAULT_STEP_SECONDS = 30;
const DEFAULT_DIGITS = 6;
const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_SEGMENT_LENGTH = 4;
const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function normalizeDigits(value) {
  const digits = Number.parseInt(String(value || DEFAULT_DIGITS), 10);
  if (!Number.isFinite(digits) || digits < 6 || digits > 8) return DEFAULT_DIGITS;
  return digits;
}

function normalizeStep(value) {
  const step = Number.parseInt(String(value || DEFAULT_STEP_SECONDS), 10);
  if (!Number.isFinite(step) || step < 15 || step > 120) return DEFAULT_STEP_SECONDS;
  return step;
}

export function generateMfaSecret() {
  return crypto.randomBytes(20).toString('hex');
}

function base32FromHex(secretHex) {
  const bytes = Buffer.from(secretHex, 'hex');
  let bits = '';
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, '0');
  }
  let output = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    output += BASE32_ALPHABET[Number.parseInt(chunk, 2)];
  }
  return output;
}

// Shown as the account name inside the user's authenticator app. The old
// default was "Employee Pulse", an internal name that never appears
// anywhere else in the product. Existing enrolments keep whatever label
// they were created with — authenticator apps store it at enrol time — so
// this only affects new enrolments.
const DEFAULT_MFA_ISSUER = 'Outlier Pulse';

function normalizeIssuer(value) {
  const raw = String(value || process.env.MFA_ISSUER || DEFAULT_MFA_ISSUER).trim();
  return raw || DEFAULT_MFA_ISSUER;
}

function accountLabel(email) {
  return String(email || 'account').trim().toLowerCase();
}

export function buildTotpUri(secretHex, { email, issuer } = {}) {
  const finalIssuer = normalizeIssuer(issuer);
  const label = `${finalIssuer}:${accountLabel(email)}`;
  const params = new URLSearchParams({
    secret: base32FromHex(secretHex),
    issuer: finalIssuer,
    algorithm: 'SHA1',
    digits: String(DEFAULT_DIGITS),
    period: String(DEFAULT_STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

function randomRecoveryCode() {
  const chars = [];
  const totalLength = RECOVERY_CODE_SEGMENT_LENGTH * 2;
  for (let i = 0; i < totalLength; i += 1) {
    const idx = crypto.randomInt(0, RECOVERY_CODE_ALPHABET.length);
    chars.push(RECOVERY_CODE_ALPHABET[idx]);
  }
  return `${chars.slice(0, RECOVERY_CODE_SEGMENT_LENGTH).join('')}-${chars
    .slice(RECOVERY_CODE_SEGMENT_LENGTH)
    .join('')}`;
}

export function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

export function normalizeRecoveryCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const size = Number.isInteger(count) && count > 0 ? Math.min(count, 20) : RECOVERY_CODE_COUNT;
  const seen = new Set();
  while (seen.size < size) {
    seen.add(randomRecoveryCode());
  }
  const codes = Array.from(seen);
  const codeHashes = codes.map((code) => hashRecoveryCode(code));
  return { codes, codeHashes };
}

export async function qrCodeDataUrlForUri(otpauthUri) {
  return QRCode.toDataURL(otpauthUri, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 220,
  });
}

export function consumeRecoveryCode(inputCode, storedCodeHashes) {
  if (!Array.isArray(storedCodeHashes) || storedCodeHashes.length === 0) {
    return { consumed: false, remainingCodeHashes: storedCodeHashes || [] };
  }
  const normalized = normalizeRecoveryCode(inputCode);
  if (!normalized) {
    return { consumed: false, remainingCodeHashes: storedCodeHashes };
  }
  const hash = hashRecoveryCode(normalized);
  const idx = storedCodeHashes.indexOf(hash);
  if (idx === -1) {
    return { consumed: false, remainingCodeHashes: storedCodeHashes };
  }
  const remainingCodeHashes = storedCodeHashes.filter((_, index) => index !== idx);
  return { consumed: true, remainingCodeHashes };
}

function hotp(secretHex, counter, digits = DEFAULT_DIGITS) {
  const key = Buffer.from(secretHex, 'hex');
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

export function generateTotpCode(secretHex, { atMs = Date.now(), stepSeconds, digits } = {}) {
  const d = normalizeDigits(digits);
  const step = normalizeStep(stepSeconds);
  const counter = Math.floor(atMs / 1000 / step);
  return hotp(secretHex, counter, d);
}

export function verifyTotpCode(code, secretHex, { atMs = Date.now(), window = 1, stepSeconds, digits } = {}) {
  if (!secretHex || !code) return false;
  const normalized = String(code).trim();
  if (!/^\d{6,8}$/.test(normalized)) return false;
  const d = normalizeDigits(digits);
  const step = normalizeStep(stepSeconds);
  const counter = Math.floor(atMs / 1000 / step);
  const maxWindow = Number.isInteger(window) && window >= 0 ? Math.min(window, 3) : 1;
  for (let offset = -maxWindow; offset <= maxWindow; offset += 1) {
    if (hotp(secretHex, counter + offset, d) === normalized) return true;
  }
  return false;
}
