import jwt from 'jsonwebtoken';
import * as Organization from '../models/Organization.js';
import * as User from '../models/User.js';

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is required');
  return s;
}

export function signToken(payload) {
  return jwt.sign(payload, getSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let decoded;
  try {
    decoded = jwt.verify(token, getSecret());
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  (async () => {
    try {
      const active = await User.isUserActive(decoded.sub);
      if (!active) {
        return res.status(401).json({ error: 'Account is no longer active' });
      }
      req.user = {
        id: decoded.sub,
        role: decoded.role,
        organizationId: decoded.organizationId,
        organizationKind: decoded.organizationKind,
      };
      next();
    } catch (e) {
      next(e);
    }
  })();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

export async function requireClientOrganization(req, res, next) {
  try {
    const org = await Organization.getOrganization(req.user.organizationId);
    if (!org || org.kind !== 'client') {
      return res.status(403).json({ error: 'Client organization only' });
    }
    next();
  } catch (e) {
    next(e);
  }
}

export async function requirePlatformAdmin(req, res, next) {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const org = await Organization.getOrganization(req.user.organizationId);
    if (!org || org.kind !== 'platform') {
      return res.status(403).json({ error: 'Platform only' });
    }
    next();
  } catch (e) {
    next(e);
  }
}
