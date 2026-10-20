jest.mock('../src/config/database', () => ({ prisma: {} }));

import { idleCutoff, IDLE_RELEASE_DAYS } from '../src/utils/stakeholder-assignment';

describe('idleCutoff', () => {
  it('defaults to 14 days', () => {
    expect(IDLE_RELEASE_DAYS).toBe(14);
  });

  it('is exactly the idle window before now', () => {
    const now = new Date('2026-10-30T12:00:00.000Z');
    expect(idleCutoff(now).toISOString()).toBe('2026-10-16T12:00:00.000Z');
  });

  it('honours a custom window', () => {
    const now = new Date('2026-10-30T12:00:00.000Z');
    expect(idleCutoff(now, 1).toISOString()).toBe('2026-10-29T12:00:00.000Z');
  });
});
