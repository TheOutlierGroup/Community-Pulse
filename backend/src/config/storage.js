import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const defaultRoot = path.join(__dirname, '../../storage');

/** Avatars live under `${root}/uploads/avatars`. Set STORAGE_PATH to a persistent disk mount on Render (e.g. /var/pulse-storage). */
export function getStorageRoot() {
  const root = process.env.STORAGE_PATH || defaultRoot;
  return path.resolve(root);
}

export function ensureStorageDirs() {
  const root = getStorageRoot();
  const exportsDir = path.join(root, 'exports');
  const reportsDir = path.join(root, 'reports');
  const uploadsDir = path.join(root, 'uploads');
  const avatarsDir = path.join(uploadsDir, 'avatars');
  const orgLogosDir = path.join(uploadsDir, 'org-logos');
  const taskImagesDir = path.join(uploadsDir, 'task-images');
  const projectFilesDir = path.join(uploadsDir, 'project-files');
  const opportunityFilesDir = path.join(uploadsDir, 'opportunity-files');
  fs.mkdirSync(exportsDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(avatarsDir, { recursive: true });
  fs.mkdirSync(orgLogosDir, { recursive: true });
  fs.mkdirSync(taskImagesDir, { recursive: true });
  fs.mkdirSync(projectFilesDir, { recursive: true });
  fs.mkdirSync(opportunityFilesDir, { recursive: true });
  return {
    root, exportsDir, reportsDir, uploadsDir, avatarsDir, orgLogosDir, taskImagesDir,
    projectFilesDir, opportunityFilesDir,
  };
}

export function avatarFilePath(filename) {
  const { avatarsDir } = ensureStorageDirs();
  const safe = path.basename(filename);
  return path.join(avatarsDir, safe);
}

export function orgLogoFilePath(filename) {
  const { orgLogosDir } = ensureStorageDirs();
  const safe = path.basename(filename);
  return path.join(orgLogosDir, safe);
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

export function reportFilePath(filename) {
  const { reportsDir } = ensureStorageDirs();
  const safe = path.basename(filename);
  return path.join(reportsDir, safe);
}

export function taskImageFilePath(filename) {
  const { taskImagesDir } = ensureStorageDirs();
  const safe = path.basename(filename);
  return path.join(taskImagesDir, safe);
}

export function projectFilePath(filename) {
  const { projectFilesDir } = ensureStorageDirs();
  const safe = path.basename(filename);
  return path.join(projectFilesDir, safe);
}

export function opportunityFilePath(filename) {
  const { opportunityFilesDir } = ensureStorageDirs();
  const safe = path.basename(filename);
  return path.join(opportunityFilesDir, safe);
}
