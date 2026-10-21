const mockFindUnique = jest.fn();

jest.mock('../src/config/database', () => ({
  prisma: { enumerator: { findUnique: (...a: any[]) => mockFindUnique(...a) } },
}));
jest.mock('../src/config', () => ({
  config: { env: 'test', jwt: { secret: 'test-secret-test-secret-test-secret-123' }, logging: { level: 'silent' } },
}));

import jwt from 'jsonwebtoken';
import { authMiddleware, invalidateAuthCache } from '../src/middleware/auth';

const SECRET = 'test-secret-test-secret-test-secret-123';
const row = (over: any = {}) => ({
  id: 'e1', loginId: 'sanjana', name: 'Sanjana', isAdmin: false, isActive: true,
  districts: [{ district: { name: 'Pune' } }], ...over,
});
const token = (id = 'e1') => jwt.sign({ id, loginId: 'x', name: 'x', isAdmin: false }, SECRET, { expiresIn: '5m' });

async function call(id = 'e1') {
  const req: any = { headers: { authorization: 'Bearer ' + token(id) }, cookies: {} };
  const next = jest.fn();
  await authMiddleware(req, {} as any, next);
  return { req, next };
}

beforeEach(() => {
  mockFindUnique.mockReset();
  invalidateAuthCache();
  jest.restoreAllMocks();
});

describe('authMiddleware lookup cache', () => {
  it('reads the account once for a burst of requests', async () => {
    mockFindUnique.mockResolvedValue(row());
    for (let i = 0; i < 4; i++) {
      const { req, next } = await call();
      expect(next).toHaveBeenCalledWith();
      expect(req.enumerator).toMatchObject({ id: 'e1', districts: ['Pune'] });
    }
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });

  it('reads again once the entry is cleared, so an admin change shows at once', async () => {
    mockFindUnique.mockResolvedValue(row());
    await call();
    mockFindUnique.mockResolvedValue(row({ districts: [{ district: { name: 'Nashik' } }] }));
    invalidateAuthCache('e1');
    const { req } = await call();
    expect(req.enumerator.districts).toEqual(['Nashik']);
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
  });

  it('reads again after the 10 second window', async () => {
    mockFindUnique.mockResolvedValue(row());
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    await call();
    clock.mockReturnValue(now + 9_000);
    await call();
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(now + 11_000);
    await call();
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
  });

  it('refuses a deactivated or missing account and never caches that', async () => {
    mockFindUnique.mockResolvedValue(null);
    const first = await call();
    expect(first.next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
    await call();
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
  });

  it('refuses straight away when a cached account is deactivated and the entry is cleared', async () => {
    mockFindUnique.mockResolvedValue(row());
    await call();
    mockFindUnique.mockResolvedValue(null);
    invalidateAuthCache('e1');
    const { next } = await call();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });

  it('gives each request its own copy, so one handler cannot change another request', async () => {
    mockFindUnique.mockResolvedValue(row());
    const a = await call();
    a.req.enumerator.districts.push('Hacked');
    a.req.enumerator.isAdmin = true;
    const b = await call();
    expect(b.req.enumerator.districts).toEqual(['Pune']);
    expect(b.req.enumerator.isAdmin).toBe(false);
  });

  it('keeps accounts separate', async () => {
    mockFindUnique.mockImplementation(({ where }: any) => Promise.resolve(row({ id: where.id, loginId: where.id })));
    const a = await call('e1');
    const b = await call('e2');
    expect(a.req.enumerator.id).toBe('e1');
    expect(b.req.enumerator.id).toBe('e2');
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
  });

  it('still rejects a bad token without touching the database', async () => {
    const req: any = { headers: { authorization: 'Bearer not-a-token' }, cookies: {} };
    const next = jest.fn();
    await authMiddleware(req, {} as any, next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});
