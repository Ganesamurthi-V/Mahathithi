import { Response } from 'express';
import { prisma } from '../../config/database';
import { AuthenticatedRequest } from '../../middleware/auth';
import { UnauthorizedError } from '../../utils/errors';

export const syncOfflineFacilities = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const enumeratorId = req.enumerator?.id;
    if (!enumeratorId) throw new UnauthorizedError('Unauthorized');

    // Fetch all facilities so the math distance algorithm on the mobile device
    // can find the nearest facility universally, regardless of where the enumerator is.
    const facilities = await prisma.facility.findMany();

    res.json({
      status: 'success',
      data: facilities,
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
