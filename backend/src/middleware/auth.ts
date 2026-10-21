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

// Who the token belongs to, with their districts, is two database round trips and was
// repeated on EVERY request. Kept for a few seconds so a burst of calls (the Home
// screen alone makes several) pays for it once. Only a found, active account is
// cached, and the admin routes that change an account clear its entry straight away,
// so the worst case is a deactivation taking effect within AUTH_CACHE_TTL_MS.
const AUTH_CACHE_TTL_MS = 10_000;
const AUTH_CACHE_MAX_ENTRIES = 2_000;
type AuthedEnumerator = NonNullable<AuthenticatedRequest['enumerator']>;
const authCache = new Map<string, { at: number; value: AuthedEnumerator }>();

/** Forget one account's cached lookup, or all of them. Call after changing an account. */
export function invalidateAuthCache(enumeratorId?: string): void {
  if (enumeratorId) authCache.delete(enumeratorId);
  else authCache.clear();
}

async function loadEnumerator(id: string): Promise<AuthedEnumerator | null> {
  const hit = authCache.get(id);
  if (hit && Date.now() - hit.at < AUTH_CACHE_TTL_MS) return hit.value;

  const enumerator = await prisma.enumerator.findUnique({
    where: { id, isActive: true },
    include: { districts: { include: { district: true } } },
  });
  if (!enumerator) {
    authCache.delete(id);
    return null;
  }

  const value: AuthedEnumerator = {
    id: enumerator.id,
    loginId: enumerator.loginId,
    name: enumerator.name,
    isAdmin: enumerator.isAdmin,
    districts: enumerator.districts.map(d => d.district.name),
  };
  if (authCache.size >= AUTH_CACHE_MAX_ENTRIES) authCache.clear();
  authCache.set(id, { at: Date.now(), value });
  return value;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.cookies && req.cookies.admin_session) {
      token = req.cookies.admin_session;
    }

    if (!token) {
      throw new UnauthorizedError('No token provided');
    }

    const decoded = jwt.verify(token, config.jwt.secret) as {
      id: string;
      loginId: string;
      name: string;
      isAdmin: boolean;
    };

    const enumerator = await loadEnumerator(decoded.id);

    if (!enumerator) {
      throw new UnauthorizedError('Account not found or deactivated');
    }

    // Copied, so a handler that edits req.enumerator cannot change the cached entry.
    req.enumerator = { ...enumerator, districts: [...enumerator.districts] };

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
