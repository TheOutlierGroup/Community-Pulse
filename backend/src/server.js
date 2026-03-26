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
import adminRoutes from './routes/admin.js';
import analyticsRoutes from './routes/analytics.js';
import platformRoutes from './routes/platformRouter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3001;

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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'pulse-api' });
});

app.use('/api/auth', authRoutes);
app.use('/api/pulse', employeeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/platform', platformRoutes);

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

const frontendDist = path.join(__dirname, '../../frontend/dist');
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
  console.log(`Pulse API listening on ${PORT}`);
});
