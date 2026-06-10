import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { ForbiddenError } from '../utils/errors';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';

/**
 * Middleware that enforces district-level access control.
 * Enumerators can only access stakeholders in their assigned districts.
 * Admins bypass this check.
 */
export async function districtGuard(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.enumerator) {
      next(new ForbiddenError('Authentication required'));
      return;
    }

    // Admins bypass district restrictions
    if (req.enumerator.isAdmin) {
      next();
      return;
    }

    const assignedDistricts = req.enumerator.districts;

    if (!assignedDistricts || assignedDistricts.length === 0) {
      next(new ForbiddenError('No districts assigned. Contact your administrator.'));
      return;
    }

    // Check if the request involves a specific stakeholder
    const stakeholderId = (req.params.stakeholderId as string) || (req.params.id as string);

    if (stakeholderId) {
      const stakeholder = await prisma.stakeholder.findUnique({
        where: { id: stakeholderId },
        select: { district: true },
      });

      if (!stakeholder) {
        next();
        return;
      }

      const stakeholderDistrict = stakeholder.district?.toUpperCase();
      const hasAccess = assignedDistricts.some(
        d => d.toUpperCase() === stakeholderDistrict
      );

      if (!hasAccess) {
        logger.warn(
          `District access denied: Enumerator ${req.enumerator.loginId} tried to access stakeholder in ${stakeholder.district}`
        );
        next(new ForbiddenError(
          `Access denied. You are not assigned to district: ${stakeholder.district}`
        ));
        return;
      }
    }

    // For search/list requests, district filtering is applied in the service layer
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Get district filter condition for Prisma queries.
 * Returns a WHERE clause to restrict results to assigned districts.
 */
export function getDistrictFilter(enumerator: AuthenticatedRequest['enumerator']): object {
  if (!enumerator) return {};
  if (enumerator.isAdmin) return {};

  return {
    district: {
      in: enumerator.districts.map(d => d.toUpperCase()),
      mode: 'insensitive' as const,
    },
  };
}
