/**
 * Who an admin-panel caller is.
 *
 *   full admin      isAdmin                    sees and does everything
 *   district admin  isDistrictAdmin            sees and edits only inside their districts
 *                                              and may not delete anything
 *   enumerator      neither                    field worker
 *
 * A district admin is NEVER isAdmin. Anything that means "skip the district check" keeps
 * reading isAdmin, so a district admin can only gain access through the explicit,
 * district-scoped paths that use these helpers.
 */
export interface RoleLike {
  isAdmin?: boolean;
  isDistrictAdmin?: boolean;
}

/** An admin-panel user of either kind. */
export function isStaff(e: RoleLike | null | undefined): boolean {
  return !!e && (e.isAdmin === true || e.isDistrictAdmin === true);
}

/** A district admin: staff whose reach is limited to their assigned districts. */
export function isScopedStaff(e: RoleLike | null | undefined): boolean {
  return !!e && e.isDistrictAdmin === true && e.isAdmin !== true;
}
