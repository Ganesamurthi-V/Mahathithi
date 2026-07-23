import { Router } from 'express';
import multer from 'multer';
import { MediaController } from './media.controller';
import { authMiddleware } from '../../middleware/auth';
import { uploadLimiter } from '../../middleware/rate-limiter';

const router = Router();
const controller = new MediaController();

/**
 * H4 FIX: sniff magic bytes to verify the actual file type, not just the
 * client-declared Content-Type header.
 *
 * Magic byte signatures for allowed types:
 *  JPEG  : FF D8 FF
 *  PNG   : 89 50 4E 47 0D 0A 1A 0A
 *  HEIC/HEIF: ISO box with 'ftyp' at offset 4 — we check for 'ftyp' + known brands
 *  MP4/MOV: ISO box with 'ftyp' at offset 4 (same as HEIC)
 *  3GPP  : ISO box with 'ftyp3gp'
 */
function detectMimeFromBytes(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return 'image/png';

  // PDF: 25 50 44 46 (%PDF)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return 'application/pdf';

  // MS Office / DOCX (ZIP-based): 50 4B 03 04 (PK..)
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  // Legacy MS Word (.doc): D0 CF 11 E0
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) return 'application/msword';

  // ISO Base Media File Format (ftyp box at byte 4-7): covers MP4, MOV, HEIC, HEIF, 3GPP
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    // Read the 4-byte brand at offset 8
    const brand = buffer.slice(8, 12).toString('ascii').toLowerCase();
    if (['heic', 'heif', 'mif1', 'msf1'].some(b => brand.startsWith(b))) return 'image/heic';
    if (['mp4', 'isom', 'avc1', 'iso2', 'mp41', 'mp42'].some(b => brand.startsWith(b))) return 'video/mp4';
    if (['qt', 'mov'].some(b => brand.startsWith(b))) return 'video/quicktime';
    if (brand.startsWith('3gp')) return 'video/3gpp';
    // Generic ISO box that didn't match a known brand — reject
    return null;
  }

  return null;
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/heic', 'image/heif',
  'video/mp4', 'video/3gpp', 'video/quicktime',
  // Document types for business document uploads (Step 7)
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

// H4 FIX: store file in memory temporarily so we can check magic bytes in fileFilter
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
  fileFilter: (req, file, cb) => {
    // First-pass: declared MIME type must be in the allowlist
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
    // Magic byte check happens in the route handler after the buffer is available
    // (multer fileFilter runs before the file is fully buffered, so we set a flag here
    // and do the real check in the controller via the req.file.buffer)
    cb(null, true);
  },
});

// H4 middleware: verify magic bytes after multer has buffered the file
function verifyMagicBytes(req: any, res: any, next: any) {
  if (!req.file?.buffer) return next();
  const detected = detectMimeFromBytes(req.file.buffer);
  if (!detected || !ALLOWED_MIME_TYPES.has(detected)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_FILE_TYPE',
        message: 'File content does not match an allowed media type',
      },
    });
  }
  // Overwrite the client-declared mimetype with the server-detected one
  req.file.mimetype = detected;
  next();
}

router.use(authMiddleware);

router.post('/upload', uploadLimiter, upload.single('file'), verifyMagicBytes, controller.upload);
router.get('/survey/:surveyId', controller.getBySurvey);
router.delete('/:id', controller.delete);

export default router;

