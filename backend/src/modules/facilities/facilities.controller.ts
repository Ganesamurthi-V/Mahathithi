import { Response } from 'express';
import { prisma } from '../../config/database';
import { AuthenticatedRequest } from '../../middleware/auth';
import { UnauthorizedError } from '../../utils/errors';

export const syncOfflineFacilities = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const enumeratorId = req.enumerator?.id;
    if (!enumeratorId) throw new UnauthorizedError('Unauthorized');

    // Ideally, we fetch facilities ONLY for the districts assigned to this enumerator.
    // Since stakeholders hold the districts, let's find unique districts for their assigned stakeholders.
    const assignedDistricts = await prisma.stakeholder.findMany({
      where: { lockedById: enumeratorId },
      select: { district: true },
      distinct: ['district']
    });

    const districts = assignedDistricts.map(d => d.district).filter(Boolean) as string[];

    // Fetch facilities for those districts
    const facilities = await prisma.facility.findMany({
      where: districts.length > 0 ? { district: { in: districts } } : undefined,
    });

    res.json({
      status: 'success',
      data: facilities,
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
