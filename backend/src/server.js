import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

import { ensureStorageDirs, exportFilePath } from './config/storage.js';
import {
  requireAuth,
  requireAdmin,
  requireClientOrganization,
  requireClientPulseService,
} from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import employeeRoutes from './routes/employees.js';
import pulseLinkRoutes from './routes/pulseLink.js';
import adminRoutes from './routes/admin.js';
import analyticsRoutes from './routes/analytics.js';
import platformRoutes from './routes/platformRouter.js';
import reportRoutes from './routes/reports.js';
import internalMaintenanceRoutes from './routes/internalMaintenance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3001;
const APP_SURFACE = String(process.env.APP_SURFACE || 'all').toLowerCase();
const isCrmSurface = APP_SURFACE === 'crm';
const isPulseSurface = APP_SURFACE === 'pulse';

if (!['all', 'crm', 'pulse'].includes(APP_SURFACE)) {
  throw new Error('APP_SURFACE must be one of: all, crm, pulse');
}

ensureStorageDirs();

const isProduction = process.env.NODE_ENV === 'production';

function assertSecurityBaseline() {
  if (!isProduction) return;
  const jwtSecret = String(process.env.JWT_SECRET || '');
  if (jwtSecret.length < 32 || jwtSecret.includes('change-me')) {
    throw new Error('JWT_SECRET must be set to a strong value in production');
  }
  const inviteSecret = String(process.env.INVITE_TOKEN_SECRET || '');
  if (inviteSecret.length < 32 || inviteSecret.includes('change-me')) {
    throw new Error('INVITE_TOKEN_SECRET must be set to a strong value in production');
  }
  if (!String(process.env.FRONTEND_ORIGIN || '').trim()) {
    throw new Error('FRONTEND_ORIGIN is required in production');
  }
}

assertSecurityBaseline();

if (isProduction) {
  // Required when running behind a proxy/load balancer (Render/Heroku/Nginx).
  app.set('trust proxy', 1);
}

function parseAllowedOrigins(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Default Helmet CSP allows img-src 'self' data: only — <img src={blob URL}> from createObjectURL is blocked.
// Opening that blob in a new tab still works; embedded avatars need blob: in img-src.
app.use(
  helmet({
    referrerPolicy: { policy: 'no-referrer' },
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'img-src': ["'self'", 'data:', 'blob:'],
      },
    },
  })
);
app.use(express.json({ limit: '1mb' }));

if (isProduction && process.env.ENFORCE_HTTPS !== 'false') {
  app.use((req, res, next) => {
    const proto = req.headers['x-forwarded-proto'];
    const isForwardedHttps = typeof proto === 'string' && proto.split(',')[0].trim() === 'https';
    const isSecure = req.secure || isForwardedHttps;
    if (isSecure) return next();
    if (req.method === 'GET' || req.method === 'HEAD') {
      return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
    }
    return res.status(400).json({ error: 'HTTPS is required' });
  });
}

const allowedOrigins = parseAllowedOrigins(process.env.FRONTEND_ORIGIN);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (!isProduction && allowedOrigins.length === 0) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    exposedHeaders: ['Content-Type'],
  })
);

function resolveCrmLoginUrl(req) {
  const configured = String(process.env.CRM_APP_URL || process.env.APP_URL || '').trim();
  if (configured) return `${configured.replace(/\/$/, '')}/login`;
  return `${req.protocol}://${req.get('host')}/login`;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'pulse-api', surface: APP_SURFACE });
});

app.use('/api/internal', internalMaintenanceRoutes);

app.use('/api/auth', authRoutes);
if (!isCrmSurface) {
  app.use('/api/pulse', employeeRoutes);
  app.use('/api/rhythm-engine', employeeRoutes);
  app.use('/api/pulse-link', pulseLinkRoutes);
  app.use('/api/rhythm-engine-link', pulseLinkRoutes);
  app.use('/api/admin', adminRoutes);
}
// Session analytics + CSV/JSON exports (admin). Available on CRM and Pulse backends so admins on
// the CRM domain hit disk-backed STORAGE_PATH; Rhythm-only servers without a disk retain ephemeral writes.
app.use('/api/analytics', analyticsRoutes);
app.get(
  '/api/exports/:filename',
  requireAuth,
  requireAdmin,
  requireClientOrganization,
  requireClientPulseService,
  (req, res) => {
    const safe = path.basename(req.params.filename);
    const full = exportFilePath(safe);
    if (!fs.existsSync(full)) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.download(full, safe);
  }
);
app.use('/api/platform', platformRoutes);
if (!isPulseSurface) {
  app.use('/api/reports', reportRoutes);
}

const frontendDist = path.join(__dirname, '../../frontend/dist');
if (isPulseSurface) {
  app.get(['/', '/login'], (req, res) => {
    const loginUrl = resolveCrmLoginUrl(req);
    res
      .status(200)
      .type('html')
      .send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Rhythm Engine</title>
    <style>
      body { font-family: Inter, system-ui, -apple-system, sans-serif; margin: 0; background: #f7f8fb; color: #111827; }
      .wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 28px; max-width: 460px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); }
      h1 { margin: 0 0 8px; font-size: 1.5rem; }
      p { margin: 0 0 16px; color: #4b5563; line-height: 1.45; }
      a { display: inline-block; text-decoration: none; background: #2563eb; color: #fff; padding: 10px 16px; border-radius: 8px; font-weight: 600; }
      a:hover { background: #1d4ed8; }
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="card">
        <h1>Rhythm Engine</h1>
        <p>Rhythm Engine access is secured. Please log in via the CRM to continue.</p>
        <a href="${loginUrl}">Log in to CRM</a>
      </section>
    </main>
  </body>
</html>`);
  });
}
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Rhythm Engine API listening on ${PORT}`);
});
