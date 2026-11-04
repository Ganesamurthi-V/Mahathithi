import { createContext, useContext } from 'react';
import { User } from './types';

const UserContext = createContext<User | null>(null);

export const UserProvider = UserContext.Provider;

/** The signed-in admin-panel user, for pages that need to know what they may do. */
export function useUser(): User | null {
  return useContext(UserContext);
}

/**
 * A district admin: an admin-panel user limited to their districts who may not delete
 * anything and does not see the Enumerators or Audit Logs pages. The server enforces all
 * of this; hiding controls here only keeps the screen honest.
 */
export function isDistrictAdminUser(user: User | null | undefined): boolean {
  return !!user && user.isDistrictAdmin === true && !user.isAdmin;
}
