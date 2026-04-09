import { randomBytes } from 'crypto';
import { hashInviteToken } from './inviteToken.js';
import * as PulseHandoffToken from '../models/PulseHandoffToken.js';

const DEFAULT_TTL_MS = 2 * 60 * 1000;

function parseTtlMs() {
  const raw = Number.parseInt(String(process.env.PULSE_HANDOFF_TTL_MS || ''), 10);
  if (!Number.isInteger(raw) || raw <= 0) return DEFAULT_TTL_MS;
  return Math.min(raw, 10 * 60 * 1000);
}

export async function createPulseHandoffToken({ userId, organizationId }) {
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = hashInviteToken(rawToken);
  const expiresAt = new Date(Date.now() + parseTtlMs());
  await PulseHandoffToken.createToken({
    tokenHash,
    userId,
    organizationId,
    audience: 'pulse',
    expiresAt,
  });
  return { token: rawToken, expiresAt };
}

export async function consumePulseHandoffToken(rawToken) {
  const normalized = String(rawToken || '').trim();
  if (!normalized) return null;
  const tokenHash = hashInviteToken(normalized);
  return PulseHandoffToken.consumeValidToken(tokenHash, 'pulse');
}
