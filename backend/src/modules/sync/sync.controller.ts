import { Response, NextFunction } from 'express';
import { SyncService } from './sync.service';
import { AuthenticatedRequest } from '../../middleware/auth';

const syncService = new SyncService();

export class SyncController {
  async upload(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const results = await syncService.processUpload(
        req.enumerator!.id,
        req.body
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
