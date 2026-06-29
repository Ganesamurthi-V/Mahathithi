export interface User {
  id: string;
  loginId: string;
  name: string;
  isAdmin: boolean;
}

export interface Enumerator {
  id: string;
  loginId: string;
  name: string;
  phone: string;
  email: string;
  isActive: boolean;
  isAdmin: boolean;
  districts: { id: string; name: string }[];
  surveysCount: number;
}

export interface District {
  id: string;
  name: string;
  state: string;
  enumeratorsCount: number;
  stakeholdersCount: number;
}
