import multer from 'multer';

// Generic document/file repository upload (Projects/Opportunity pages) —
// broader than the image-only avatar/logo uploads, since these are meant
// to hold real deliverables (decks, spreadsheets, PDFs, contracts).
const ALLOWED_EXT = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.ppt', '.pptx',
  '.txt', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip',
]);

function extensionForRepositoryFile(originalName) {
  const match = String(originalName || '').match(/\.[a-z0-9]+$/i);
  return match ? match[0].toLowerCase() : '';
}

const repositoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_EXT.has(extensionForRepositoryFile(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('That file type is not supported.'));
    }
  },
}).single('file');

function uploadError(err) {
  if (err?.code === 'LIMIT_FILE_SIZE') return 'File must be 25MB or smaller.';
  return err?.message || 'Upload failed.';
}

export function handleRepositoryFileUpload(req, res, next) {
  repositoryUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: uploadError(err) });
    next();
  });
}
