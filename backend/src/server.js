import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

import { ensureStorageDirs, exportFilePath } from './config/storage.js';
import { requireAuth, requireAdmin } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import employeeRoutes from './routes/employees.js';
import adminRoutes from './routes/admin.js';
import analyticsRoutes from './routes/analytics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3001;

ensureStorageDirs();

app.use(helmet());
app.use(express.json({ limit: '1mb' }));

const origin = process.env.FRONTEND_ORIGIN;
app.use(
  cors({
    origin: origin || true,
    credentials: true,
  })
);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'pulse-api' });
});

app.use('/api/auth', authRoutes);
app.use('/api/pulse', employeeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/analytics', analyticsRoutes);

app.get(
  '/api/exports/:filename',
  requireAuth,
  requireAdmin,
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
