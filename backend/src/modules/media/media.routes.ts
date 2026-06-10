import { Router } from 'express';
import multer from 'multer';
import { MediaController } from './media.controller';
import { authMiddleware } from '../../middleware/auth';
import { uploadLimiter } from '../../middleware/rate-limiter';

const router = Router();
const controller = new MediaController();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/heic', 'image/heif',
      'video/mp4', 'video/3gpp', 'video/quicktime',
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}`));
    }
  },
});

router.use(authMiddleware);

router.post('/upload', uploadLimiter, upload.single('file'), controller.upload);
router.get('/survey/:surveyId', controller.getBySurvey);
router.delete('/:id', controller.delete);

export default router;
