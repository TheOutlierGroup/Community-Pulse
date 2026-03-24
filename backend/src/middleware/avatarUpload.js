import path from 'path';
import multer from 'multer';
import { ensureStorageDirs } from '../config/storage.js';

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

function avatarStorage() {
  const { avatarsDir } = ensureStorageDirs();
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, avatarsDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const e = ALLOWED_EXT.has(ext) ? ext : '.jpg';
      cb(null, `${req.user.id}${e}`);
    },
  });
}

export const uploadAvatarMiddleware = multer({
  storage: avatarStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.has(ext) || /^image\//.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
}).single('avatar');
