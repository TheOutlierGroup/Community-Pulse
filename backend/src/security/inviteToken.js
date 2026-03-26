import { createHash, createHmac } from 'crypto';

function normalizeToken(token) {
  return String(token || '').trim();
}

export function hashInviteToken(token) {
  const normalized = normalizeToken(token);
  const secret = process.env.INVITE_TOKEN_SECRET || process.env.JWT_SECRET || '';

  if (secret) {
    return `v1:${createHmac('sha256', secret).update(normalized).digest('hex')}`;
  }

  // Fallback for local/dev environments where no secret is configured.
  return `v0:${createHash('sha256').update(normalized).digest('hex')}`;
}
