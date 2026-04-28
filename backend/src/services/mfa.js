import crypto from 'crypto';

const DEFAULT_STEP_SECONDS = 30;
const DEFAULT_DIGITS = 6;

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
