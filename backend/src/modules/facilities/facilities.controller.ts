import { Response } from 'express';
import { prisma } from '../../config/database';
import { AuthenticatedRequest } from '../../middleware/auth';
import { UnauthorizedError } from '../../utils/errors';

export const syncOfflineFacilities = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const enumeratorId = req.enumerator?.id;
    if (!enumeratorId) throw new UnauthorizedError('Unauthorized');

    // Fetch enumerator's assigned districts
    const assignedDistricts = await prisma.enumeratorDistrict.findMany({
      where: { enumeratorId },
      include: { district: true }
    });
    const districtNames = assignedDistricts.map(ad => ad.district.name);

    if (districtNames.length === 0) {
      return res.json({ status: 'success', data: [] });
    }

    // Fetch only facilities for the assigned districts with specific fields
    const facilities = await prisma.facility.findMany({
      where: {
        district: {
          in: districtNames,
          mode: 'insensitive'
        }
      },
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
