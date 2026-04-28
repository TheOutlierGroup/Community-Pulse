import jwt from 'jsonwebtoken';
import * as Organization from '../models/Organization.js';
import * as User from '../models/User.js';
import {
  CLIENT_SERVICE_PULSE,
  organizationHasService,
} from '../services/clientServices.js';

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is required');
  return s;
}

function jwtOptions() {
  const opts = { algorithms: ['HS256'] };
  if (process.env.JWT_ISSUER) opts.issuer = process.env.JWT_ISSUER;
  if (process.env.JWT_AUDIENCE) opts.audience = process.env.JWT_AUDIENCE;
  return opts;
}

export function signToken(payload) {
  return jwt.sign(payload, getSecret(), {
    algorithm: 'HS256',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    issuer: process.env.JWT_ISSUER || undefined,
    audience: process.env.JWT_AUDIENCE || undefined,
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
    decoded = jwt.verify(token, getSecret(), jwtOptions());
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
        mfaVerifiedAt: decoded.mfaVerifiedAt || null,
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
  const enforceAdminMfa = String(process.env.MFA_ENFORCE_ADMIN || 'true').trim().toLowerCase() !== 'false';
  if (enforceAdminMfa && !req.user?.mfaVerifiedAt) {
    return res.status(403).json({ error: 'MFA required for admin actions' });
  }
  next();
}

export async function requireClientOrganization(req, res, next) {
  try {
    const org = req.clientOrganization || (await Organization.getOrganization(req.user.organizationId));
    if (!org || org.kind !== 'client') {
      return res.status(403).json({ error: 'Client organization only' });
    }
    req.clientOrganization = org;
    next();
  } catch (e) {
    next(e);
  }
}

export async function requirePlatformAdmin(req, res, next) {
  try {
    const org = await Organization.getOrganization(req.user.organizationId);
    if (!org || org.kind !== 'platform') {
      return res.status(403).json({ error: 'Platform only' });
    }
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    req.platformOrganization = org;
    next();
  } catch (e) {
    next(e);
  }
}

export async function requirePlatformUser(req, res, next) {
  try {
    const org = await Organization.getOrganization(req.user.organizationId);
    if (!org || org.kind !== 'platform') {
      return res.status(403).json({ error: 'Platform only' });
    }
    req.platformOrganization = org;
    next();
  } catch (e) {
    next(e);
  }
}

export function buildRequireClientPulseService({
  getOrganization = Organization.getOrganization,
} = {}) {
  return async function requireClientPulseService(req, res, next) {
    try {
      const org = req.clientOrganization || (await getOrganization(req.user.organizationId));
      if (!org || org.kind !== 'client') {
        return res.status(403).json({ error: 'Client organization only' });
      }
      req.clientOrganization = org;
      if (!organizationHasService(org.settings, CLIENT_SERVICE_PULSE)) {
        return res.status(403).json({ error: 'Rhythm Engine is not enabled for this client' });
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

export const requireClientPulseService = buildRequireClientPulseService();
