import { ForbiddenError } from './errors';

interface StakeholderDistrictLike {
  district?: string | null;
  status?: string;
}

/**
 * SHARED FIX (C2, C3, C4, C5, C6, H1):
 *
 * Throws ForbiddenError unless the caller is admin, or the stakeholder's
 * district is in the caller's list of assigned districts.
 *
 * This is the single source of truth for "can this enumerator touch this
 * stakeholder's data". Call it from every module that reads or writes
 * stakeholder-scoped data (surveys, media, phone validations, sync).
 */
export function assertStakeholderAccess(
  stakeholder: StakeholderDistrictLike,
  callerDistricts: string[],
  isAdmin: boolean
): void {
  if (isAdmin) return;

  if (!stakeholder.district) {
    throw new ForbiddenError(
      'Stakeholder has no district assigned — admin review required'
    );
  }

  const hasAccess = callerDistricts.some(
    (d) => d.toUpperCase() === stakeholder.district!.toUpperCase()
  );

  if (!hasAccess) {
    throw new ForbiddenError(
      `Access denied. You are not assigned to district: ${stakeholder.district}`
    );
  }
}
