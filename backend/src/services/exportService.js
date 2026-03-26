import fs from 'fs';
import { exportFilePath, ensureStorageDirs } from '../config/storage.js';

/**
 * Simple JSON export to disk (Render persistent disk).
 * PDF generation can be added later; API returns downloadable path or streams file.
 */
export async function writeSessionExport(sessionId, payload) {
  ensureStorageDirs();
  const filename = `session-${sessionId}-${Date.now()}.json`;
  const full = exportFilePath(filename);
  await fs.promises.writeFile(full, JSON.stringify(payload), 'utf8');
  return { filename, fullPath: full };
}
