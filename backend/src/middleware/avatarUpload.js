import path from 'path';
import multer from 'multer';
import { ensureStorageDirs } from '../config/storage.js';

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

export function extensionForUpload(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_EXT.has(ext)) return ext;
  const mime = String(file.mimetype || '').toLowerCase();
  return MIME_TO_EXT[mime] || null;
}

function avatarStorage() {
  const { avatarsDir } = ensureStorageDirs();
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, avatarsDir);
    },
    filename: (req, file, cb) => {
      const e = extensionForUpload(file);
      cb(null, `${req.user.id}${e || '.png'}`);
    },
  });
}

export const uploadAvatarMiddleware = multer({
  storage: avatarStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (extensionForUpload(file)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, GIF, or WebP are allowed'));
    }
  },
}).single('avatar');
