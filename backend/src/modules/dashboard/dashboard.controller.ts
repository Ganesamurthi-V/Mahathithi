import { Response, NextFunction } from 'express';
import { DashboardService } from './dashboard.service';
import { AuthenticatedRequest } from '../../middleware/auth';

const dashboardService = new DashboardService();

export class DashboardController {
  async getStats(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const stats = await dashboardService.getStats(
        req.enumerator!.id,
        req.enumerator!.districts,
        req.enumerator!.isAdmin
      );

      res.json({
        success: true,
        data: {
          ...stats,
          lastSyncTime: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  }
}
