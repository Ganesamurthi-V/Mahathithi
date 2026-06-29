import { Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { AuthenticatedRequest } from '../../middleware/auth';
import { UnauthorizedError } from '../../utils/errors';

// H6 FIX: added NextFunction so errors go through the shared errorHandler,
// which strips internal details (Prisma table names, constraint names, stack
// traces) in production. The old code always called res.status(500).json({ message: error.message })
// regardless of environment, leaking DB internals to any caller.
export const syncOfflineFacilities = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const enumeratorId = req.enumerator?.id;
    if (!enumeratorId) throw new UnauthorizedError('Unauthorized');

    const facilities = await prisma.facility.findMany({
      select: {
        id: true,
        name: true,
        type: true,
        district: true,
        latitude: true,
        longitude: true,
      },
    });

    res.json({ status: 'success', data: facilities });
  } catch (error) {
    next(error); // let the shared errorHandler decide what's safe to expose
  }
};

