import fs from 'fs';
import { exportFilePath, ensureStorageDirs } from '../config/storage.js';

/**
 * Simple JSON export to disk (Render persistent disk).
 * PDF generation can be added later; API returns downloadable path or streams file.
 */
export function writeSessionExport(sessionId, payload) {
  ensureStorageDirs();
  const filename = `session-${sessionId}-${Date.now()}.json`;
  const full = exportFilePath(filename);
  fs.writeFileSync(full, JSON.stringify(payload, null, 2), 'utf8');
  return { filename, fullPath: full };
}
