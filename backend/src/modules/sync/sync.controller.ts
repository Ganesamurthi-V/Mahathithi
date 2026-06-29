import { Response, NextFunction } from 'express';
import { SyncService } from './sync.service';
import { AuthenticatedRequest } from '../../middleware/auth';
import { syncUploadSchema } from '../../schemas/request-schemas';

const syncService = new SyncService();

export class SyncController {
  async upload(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      // M5 FIX: validate + enforce length limits on every field in the batch
      const validated = syncUploadSchema.parse(req.body);

      // H1 FIX: pass caller's districts and admin flag for district enforcement
      const results = await syncService.processUpload(
        req.enumerator!.id,
        validated,
        req.enumerator!.districts,
        req.enumerator!.isAdmin
      );

      res.json({ success: true, data: results });
    } catch (error) {
      next(error);
    }
  }

  async getChanges(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { since } = req.query;
      const changes = await syncService.getChanges(
        req.enumerator!.id,
        req.enumerator!.districts,
        since as string
      );

      res.json({ success: true, data: changes });
    } catch (error) {
      next(error);
    }
  }
}
