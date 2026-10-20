import { AppError, ForbiddenError } from './errors';
import { prisma } from '../config/database';

interface StakeholderDistrictLike {
  id?: string;
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

/**
 * Stakeholders (out of `stakeholderIds`) where this enumerator already has work of
 * their own: a survey on the server, or a claim that was taken back from them.
 *
 * WHY DISTRICT SCOPE ALONE IS NOT ENOUGH
 * An admin can move an enumerator out of a district while they are mid-survey on a
 * record there, or while a completed survey is still sitting offline on their phone.
 * Judging that upload by their CURRENT districts rejects it, and field work that was
 * done in good faith is thrown away. So the district rule stays for new work, but
 * work an enumerator demonstrably started — or held a claim on — is theirs to finish.
 *
 * The revocation rows are what make the second half possible for a survey that never
 * reached the server: a claim taken back from them is recorded there.
 */
export async function ownWorkStakeholderIds(
  enumeratorId: string,
  stakeholderIds: string[],
): Promise<Set<string>> {
  const ids = [...new Set(stakeholderIds.filter(Boolean))];
  if (ids.length === 0) return new Set();

  const [surveys, revocations] = await Promise.all([
    prisma.survey.findMany({
      where: { enumeratorId, stakeholderId: { in: ids } },
      select: { stakeholderId: true },
    }),
    prisma.stakeholderRevocation.findMany({
      where: { enumeratorId, stakeholderId: { in: ids } },
      select: { stakeholderId: true },
    }),
  ]);

  return new Set([...surveys.map((s) => s.stakeholderId), ...revocations.map((r) => r.stakeholderId)]);
}

/**
 * assertStakeholderAccess, except that an enumerator's own earlier work on the
 * record is allowed through even when it is now outside their districts.
 */
export async function assertAccessOrOwnWork(
  stakeholder: StakeholderDistrictLike & { id: string },
  callerDistricts: string[],
  isAdmin: boolean,
  enumeratorId: string,
): Promise<void> {
  try {
    assertStakeholderAccess(stakeholder, callerDistricts, isAdmin);
  } catch (err) {
    // Matched on the code, not instanceof: AppError resets the prototype in its
    // constructor, so a ForbiddenError is never an instance of ForbiddenError.
    if (err instanceof AppError && err.code === 'FORBIDDEN') {
      const own = await ownWorkStakeholderIds(enumeratorId, [stakeholder.id]);
      if (own.has(stakeholder.id)) return;
    }
    throw err;
  }
}
