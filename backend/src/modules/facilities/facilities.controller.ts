import { Response } from 'express';
import { prisma } from '../../config/database';
import { AuthenticatedRequest } from '../../middleware/auth';
import { UnauthorizedError } from '../../utils/errors';

export const syncOfflineFacilities = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const enumeratorId = req.enumerator?.id;
    if (!enumeratorId) throw new UnauthorizedError('Unauthorized');

    // We are no longer filtering facilities by assigned district.
    // Fetch all facilities across the entire database for all users.

    // Fetch all facilities across all districts as requested
    const facilities = await prisma.facility.findMany({
      select: {
        id: true,
        name: true,
        type: true,
        district: true,
        latitude: true,
        longitude: true
      }
    });

    res.json({
      status: 'success',
      data: facilities,
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
