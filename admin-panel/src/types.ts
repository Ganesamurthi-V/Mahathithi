export interface User {
  id: string;
  loginId: string;
  name: string;
  isAdmin: boolean;
  /** Admin-panel user limited to their districts; never true together with isAdmin. */
  isDistrictAdmin?: boolean;
  districts?: { id: string; name: string; state?: string }[];
}

export interface Enumerator {
  id: string;
  loginId: string;
  name: string;
  phone: string;
  email: string;
  isActive: boolean;
  isAdmin: boolean;
  isDistrictAdmin?: boolean;
  districts: { id: string; name: string }[];
  surveysCount: number;
}

export interface District {
  id: string;
  name: string;
  state: string;
  enumeratorsCount: number;
  stakeholdersCount: number;
  /** Surveys completed on stakeholders in this district. */
  completedSurveysCount: number;
  /** completedSurveysCount as a percentage of stakeholdersCount. */
  coverage: number;
}
