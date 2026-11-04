import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { ForbiddenError } from '../utils/errors';
import { isScopedStaff } from '../utils/roles';

/**
 * What a district admin may call under /api/admin.
 *
 * DEFAULT DENY. A full admin passes everything. A district admin passes only the routes
 * listed here, so a route added to admin.routes.ts later is closed to them until someone
 * decides otherwise. Enumerator management, district assignment, rebalancing, audit logs
 * and every delete are simply not on the list.
 *
 * Each handler on this list ALSO scopes its data to the caller's districts; being on the
 * list only means the request reaches the handler.
 *
 * Paths are relative to the /api/admin mount, matched case-sensitively and anchored, so a
 * look-alike path does not slip through. Express routing is case-insensitive, so a
 * differently-cased path is refused here rather than allowed: it fails closed.
 */
const ALLOWED: ReadonlyArray<readonly [method: string, path: RegExp]> = [
  ['GET', /^\/analytics$/],
  ['GET', /^\/districts$/],
  ['GET', /^\/export\/surveys\/list$/],
  ['GET', /^\/export\/sync-status$/],
  ['GET', /^\/export\/surveys$/],
  ['POST', /^\/export\/surveys$/],
  ['GET', /^\/surveys\/review$/],
  ['POST', /^\/surveys\/[^/]+\/review\/resolve$/],
  ['POST', /^\/stakeholders\/[^/]+\/take-survey$/],
  ['PATCH', /^\/surveys\/[^/]+$/],
  ['POST', /^\/surveys\/[^/]+\/finalize$/],
];

export function isAllowedForDistrictAdmin(method: string, path: string): boolean {
  const normalised = path.replace(/\/+$/, '') || '/';
  const verb = method.toUpperCase();
  return ALLOWED.some(([m, re]) => m === verb && re.test(normalised));
}

export function districtAdminGate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!isScopedStaff(req.enumerator)) {
    next();
    return;
  }

  if (isAllowedForDistrictAdmin(req.method, req.path)) {
    next();
    return;
  }

  next(new ForbiddenError('This action is not available to district admins'));
}

/**
 * For routes outside /admin that exist for a field worker's phone (claim a work queue,
 * download it, lock a record): a district admin has no work queue and must not use them.
 */
export function denyDistrictAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (isScopedStaff(req.enumerator)) {
    next(new ForbiddenError('Not available to district admins'));
    return;
  }
  next();
}
