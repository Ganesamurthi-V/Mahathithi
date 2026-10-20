import { haversineKm, gpsMismatchReason, gpsFlagDistanceKm } from '../src/utils/gps-check';

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm(18.52, 73.85, 18.52, 73.85)).toBeCloseTo(0, 5);
  });

  it('matches a known distance (Pune to Mumbai is about 120 km)', () => {
    const km = haversineKm(18.5204, 73.8567, 19.076, 72.8777);
    expect(km).toBeGreaterThan(115);
    expect(km).toBeLessThan(125);
  });

  it('is symmetric', () => {
    expect(haversineKm(18.5, 73.8, 19.0, 72.8)).toBeCloseTo(haversineKm(19.0, 72.8, 18.5, 73.8), 6);
  });
});

describe('gpsMismatchReason', () => {
  const business = { latitude: 18.5204, longitude: 73.8567 };

  it('defaults to a 5 km limit', () => {
    expect(gpsFlagDistanceKm()).toBe(5);
  });

  it('accepts a survey taken at the business', () => {
    expect(gpsMismatchReason({ latitude: 18.5206, longitude: 73.8569 }, business)).toBeNull();
  });

  it('accepts a survey a couple of km away (geocoding error is normal)', () => {
    expect(gpsMismatchReason({ latitude: 18.54, longitude: 73.86 }, business)).toBeNull();
  });

  it('flags a survey 40 km away and says how far', () => {
    const reason = gpsMismatchReason({ latitude: 18.9, longitude: 73.9 }, business);
    expect(reason).toMatch(/km from the business/);
    expect(reason).toMatch(/limit 5 km/);
  });

  it('respects a custom limit', () => {
    const survey = { latitude: 18.54, longitude: 73.86 };
    expect(gpsMismatchReason(survey, business, 1)).not.toBeNull();
  });

  it('does not flag when either side has no coordinates', () => {
    expect(gpsMismatchReason({ latitude: null, longitude: null }, business)).toBeNull();
    expect(gpsMismatchReason({ latitude: 18.5, longitude: 73.8 }, { latitude: null, longitude: null })).toBeNull();
  });

  it('does not treat a 0,0 fix as a real position', () => {
    expect(gpsMismatchReason({ latitude: 0, longitude: 0 }, business)).toBeNull();
  });
});
