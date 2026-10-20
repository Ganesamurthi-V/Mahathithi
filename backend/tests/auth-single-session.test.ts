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

const DAY = 24 * 60 * 60 * 1000;
const baseEnumerator = {
  id: 'e1', loginId: 'sanjana', name: 'Sanjana', phone: null, email: null,
  isActive: true, isAdmin: false, passwordHash: 'x', districts: [],
};

const auth = new AuthService();
const login = (takeover?: boolean) => auth.login('sanjana', 'pw', 'okhttp', '1.2.3.4', takeover);

beforeEach(() => {
  [mockFindUnique, mockSessionFindMany, mockSessionUpdateMany, mockSessionCreate, mockAuditCreate].forEach((m) => m.mockReset());
  mockFindUnique.mockResolvedValue(baseEnumerator);
  mockSessionFindMany.mockResolvedValue([]);
  mockSessionUpdateMany.mockResolvedValue({ count: 0 });
  mockSessionCreate.mockResolvedValue({});
  mockAuditCreate.mockResolvedValue({});
});

describe('login: one active phone per enumerator', () => {
  it('signs in normally when no other session exists', async () => {
    await expect(login()).resolves.toHaveProperty('tokens');
    expect(mockSessionUpdateMany).not.toHaveBeenCalled();
    expect(mockSessionCreate).toHaveBeenCalledTimes(1);
  });

  it('asks for confirmation when another phone used the account recently', async () => {
    mockSessionFindMany.mockResolvedValue([{ updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) }]);
    await expect(login()).rejects.toMatchObject({
      statusCode: 409,
      code: 'SESSION_ACTIVE_ELSEWHERE',
    });
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockSessionUpdateMany).not.toHaveBeenCalled();
  });

  it('reports when the other phone was last active', async () => {
    const lastActive = new Date(Date.now() - 3 * 60 * 60 * 1000);
    mockSessionFindMany.mockResolvedValue([{ updatedAt: lastActive }]);
    await expect(login()).rejects.toMatchObject({ errors: [{ lastActiveAt: lastActive.toISOString() }] });
  });

  it('ends the other session and logs in once the user confirms', async () => {
    mockSessionFindMany.mockResolvedValue([{ updatedAt: new Date(Date.now() - 60 * 60 * 1000) }]);
    await expect(login(true)).resolves.toHaveProperty('tokens');
    expect(mockSessionUpdateMany).toHaveBeenCalledWith({
      where: { enumeratorId: 'e1', isValid: true },
      data: { isValid: false },
    });
    expect(mockSessionCreate).toHaveBeenCalledTimes(1);
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'session_replaced' }) }),
    );
  });

  it('does not prompt for a long-abandoned session, but still ends it', async () => {
    mockSessionFindMany.mockResolvedValue([{ updatedAt: new Date(Date.now() - 40 * DAY) }]);
    await expect(login()).resolves.toHaveProperty('tokens');
    expect(mockSessionUpdateMany).toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'session_replaced' }) }),
    );
  });

  it('tells a deactivated account apart from an expired session', async () => {
    mockFindUnique.mockResolvedValue({ ...baseEnumerator, isActive: false });
    await expect(login()).rejects.toMatchObject({ statusCode: 401, code: 'ACCOUNT_DEACTIVATED' });
  });

  it('never restricts an admin', async () => {
    mockFindUnique.mockResolvedValue({ ...baseEnumerator, isAdmin: true });
    mockSessionFindMany.mockResolvedValue([{ updatedAt: new Date() }]);
    await expect(login()).resolves.toHaveProperty('tokens');
    expect(mockSessionFindMany).not.toHaveBeenCalled();
    expect(mockSessionUpdateMany).not.toHaveBeenCalled();
  });
});
