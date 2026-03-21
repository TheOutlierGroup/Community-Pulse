import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const defaultRoot = path.join(__dirname, '../../storage');

export function getStorageRoot() {
  const root = process.env.STORAGE_PATH || defaultRoot;
  return path.resolve(root);
}

export function ensureStorageDirs() {
  const root = getStorageRoot();
  const exportsDir = path.join(root, 'exports');
  const uploadsDir = path.join(root, 'uploads');
  fs.mkdirSync(exportsDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });
  return { root, exportsDir, uploadsDir };
}

export function exportFilePath(filename) {
  const { exportsDir } = ensureStorageDirs();
  const safe = path.basename(filename);
  return path.join(exportsDir, safe);
}

export function uploadFilePath(filename) {
  const { uploadsDir } = ensureStorageDirs();
  const safe = path.basename(filename);
  return path.join(uploadsDir, safe);
}
