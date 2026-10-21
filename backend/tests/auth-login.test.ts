const mockFindUnique = jest.fn();
const mockSessionFindMany = jest.fn();
const mockSessionUpdateMany = jest.fn();
const mockSessionCreate = jest.fn();
const mockAuditCreate = jest.fn();

jest.mock('../src/config/database', () => ({
  prisma: {
    enumerator: { findUnique: (...a: any[]) => mockFindUnique(...a) },
    session: {
      findMany: (...a: any[]) => mockSessionFindMany(...a),
      updateMany: (...a: any[]) => mockSessionUpdateMany(...a),
      create: (...a: any[]) => mockSessionCreate(...a),
    },
    auditLog: { create: (...a: any[]) => mockAuditCreate(...a) },
  },
}));
jest.mock('../src/config/redis', () => ({
  redisClient: {
    get: jest.fn().mockResolvedValue(null),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));
jest.mock('../src/config', () => ({
  config: {
    env: 'test',
    jwt: { secret: 'test-secret', accessExpiry: '15m', sessionExpiryDays: 365 },
    logging: { level: 'silent' },
  },
}));
jest.mock('bcryptjs', () => ({ __esModule: true, default: { compare: jest.fn().mockResolvedValue(true) } }));

import { AuthService } from '../src/modules/auth/auth.service';

const baseEnumerator = {
  id: 'e1', loginId: 'sanjana', name: 'Sanjana', phone: null, email: null,
  isActive: true, isAdmin: false, passwordHash: 'x', districts: [],
};

const auth = new AuthService();
const login = () => auth.login('sanjana', 'pw', 'okhttp', '1.2.3.4');

beforeEach(() => {
  [mockFindUnique, mockSessionFindMany, mockSessionUpdateMany, mockSessionCreate, mockAuditCreate].forEach((m) => m.mockReset());
  mockFindUnique.mockResolvedValue(baseEnumerator);
  mockSessionFindMany.mockResolvedValue([]);
  mockSessionUpdateMany.mockResolvedValue({ count: 0 });
  mockSessionCreate.mockResolvedValue({});
  mockAuditCreate.mockResolvedValue({});
});

describe('login', () => {
  it('signs in and creates a session', async () => {
    await expect(login()).resolves.toHaveProperty('tokens');
    expect(mockSessionCreate).toHaveBeenCalledTimes(1);
  });

  it('lets the same account sign in on a second phone without touching the first', async () => {
    mockSessionFindMany.mockResolvedValue([{ updatedAt: new Date() }]);
    await expect(login()).resolves.toHaveProperty('tokens');
    expect(mockSessionCreate).toHaveBeenCalledTimes(1);
    expect(mockSessionUpdateMany).not.toHaveBeenCalled();
    expect(mockSessionFindMany).not.toHaveBeenCalled();
  });

  it('tells a deactivated account apart from an expired session', async () => {
    mockFindUnique.mockResolvedValue({ ...baseEnumerator, isActive: false });
    await expect(login()).rejects.toMatchObject({ statusCode: 401, code: 'ACCOUNT_DEACTIVATED' });
  });
});
