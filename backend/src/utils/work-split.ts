export interface DistrictCap {
  district: string;
  /** Most this enumerator may hold here: ceil(openTotal / enumeratorsInDistrict). */
  cap: number;
}

/**
 * Split one enumerator's quota equally across their districts.
 *
 *   2 districts -> 50% / 50%        3 -> 33% / 33% / 34%        4 -> 25% each
 *
 * Districts are ordered by name so the split is stable between calls (claim,
 * claw-back and rebalance must all agree on the same targets), and the remainder
 * of an uneven split goes to the last district: 5000 over 3 is 1666 / 1666 / 1668.
 *
 * A district that cannot supply its equal portion — few open records, or colleagues
 * sharing it — is held at its cap, and the unused portion is spread equally over the
 * districts that still have room. A thin district therefore never leaves the phone
 * short while other districts have records to give.
 */
export function allocateEqualSplit(caps: DistrictCap[], quota: number): Map<string, number> {
  const result = new Map<string, number>();
  let active = [...caps].sort((a, b) => (a.district < b.district ? -1 : a.district > b.district ? 1 : 0));
  for (const c of active) result.set(c.district, 0);

  let left = quota;
  while (active.length > 0 && left > 0) {
    const n = active.length;
    const base = Math.floor(left / n);
    const remainder = left - base * n;
    const portion = (i: number) => base + (i === n - 1 ? remainder : 0);

    const saturated = active.filter((c, i) => c.cap <= portion(i));
    if (saturated.length === 0) {
      active.forEach((c, i) => result.set(c.district, portion(i)));
      break;
    }

    for (const c of saturated) {
      const cap = Math.max(0, c.cap);
      result.set(c.district, cap);
      left -= cap;
    }
    active = active.filter((c) => !saturated.includes(c));
  }

  return result;
}
