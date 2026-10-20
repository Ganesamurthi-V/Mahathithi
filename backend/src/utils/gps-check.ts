const EARTH_RADIUS_KM = 6371;

/**
 * Distance beyond which a survey's GPS is flagged for an admin to look at.
 *
 * The stakeholder coordinates in the dataset were geocoded from addresses and are
 * often off by a few kilometres, so a tight limit would flag half the surveys. 5 km
 * catches a survey done in the wrong town without drowning the admin in noise.
 * Override with GPS_FLAG_DISTANCE_KM.
 */
export function gpsFlagDistanceKm(): number {
  const fromEnv = Number(process.env.GPS_FLAG_DISTANCE_KM);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 5;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * A reason string when the survey's GPS is farther from the business than the limit,
 * otherwise null. Null too when either side has no coordinates: there is nothing to
 * compare, and a missing fix is not evidence of anything.
 */
export function gpsMismatchReason(
  survey: { latitude?: number | null; longitude?: number | null },
  stakeholder: { latitude?: number | null; longitude?: number | null },
  limitKm: number = gpsFlagDistanceKm(),
): string | null {
  const { latitude: sLat, longitude: sLon } = survey;
  const { latitude: bLat, longitude: bLon } = stakeholder;
  if (sLat == null || sLon == null || bLat == null || bLon == null) return null;
  if (sLat === 0 && sLon === 0) return null;

  const km = haversineKm(sLat, sLon, bLat, bLon);
  if (km <= limitKm) return null;
  return `Survey GPS is ${km.toFixed(1)} km from the business (limit ${limitKm} km)`;
}
