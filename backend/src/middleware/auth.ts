import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../config/database';
import { UnauthorizedError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  enumerator?: {
    id: string;
    loginId: string;
    name: string;
    isAdmin: boolean;
    districts: string[];
  };
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('No token provided');
    }

    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(token, config.jwt.secret) as {
      id: string;
      loginId: string;
      name: string;
      isAdmin: boolean;
    };

    // Fetch enumerator with districts
    const enumerator = await prisma.enumerator.findUnique({
      where: { id: decoded.id, isActive: true },
      include: {
        districts: {
          include: {
            district: true,
          },
        },
      },
    });

    if (!enumerator) {
      throw new UnauthorizedError('Account not found or deactivated');
    }

    req.enumerator = {
      id: enumerator.id,
      loginId: enumerator.loginId,
      name: enumerator.name,
      isAdmin: enumerator.isAdmin,
      districts: enumerator.districts.map(d => d.district.name),
    };

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      next(new UnauthorizedError('Token expired'));
    } else if (error.name === 'JsonWebTokenError') {
      next(new UnauthorizedError('Invalid token'));
    } else {
      next(error);
    }
  }
}

export function adminOnly(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.enumerator?.isAdmin) {
    next(new UnauthorizedError('Admin access required'));
    return;
  }
  next();
}
