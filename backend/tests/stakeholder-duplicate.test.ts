// Duplicate business names: refused on create and on rename; suggestions are scoped and safe.

const tx = {
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  stakeholder: { aggregate: jest.fn(), create: jest.fn(), update: jest.fn() },
};
const m = {
  transaction: jest.fn(),
  queryRaw: jest.fn(),
  stakeholderFindUnique: jest.fn(),
  stakeholderUpdate: jest.fn(),
  auditCreate: jest.fn(),
  districtFindMany: jest.fn(),
};

jest.mock('../src/config/database', () => ({
  prisma: {
    $transaction: (...a: any[]) => m.transaction(...a),
    $queryRaw: (...a: any[]) => m.queryRaw(...a),
    stakeholder: {
      findUnique: (...a: any[]) => m.stakeholderFindUnique(...a),
      update: (...a: any[]) => m.stakeholderUpdate(...a),
    },
    auditLog: { create: (...a: any[]) => m.auditCreate(...a) },
    district: { findMany: (...a: any[]) => m.districtFindMany(...a) },
  },
}));
jest.mock('../src/config', () => ({ config: { env: 'test', logging: { level: 'silent' } } }));
jest.mock('../src/realtime/events', () => ({ broadcastChange: jest.fn() }));
jest.mock('../src/realtime/socket', () => ({ emitToDistrictAndAdmins: jest.fn() }));
jest.mock('../src/utils/category-scope', () => ({ categoryFilter: jest.fn().mockResolvedValue(null) }));

import { Prisma } from '@prisma/client';
import { StakeholderService } from '../src/modules/stakeholder/stakeholder.service';
import { StakeholderController } from '../src/modules/stakeholder/stakeholder.controller';
import { invalidateDistrictCache } from '../src/utils/district-scope';
import { buildSuggestQuery, escapeLike } from '../src/utils/stakeholder-name';

const service = new StakeholderService();
const admin = { id: 'a1', districts: [], isAdmin: true };
const enumerator = { id: 'e1', districts: ['Pune'], isAdmin: false };
const EXISTING = { id: 's-old', name: 'AL- MIZAN', district: 'Pune', city: 'Pune City', pinCode: '411001', status: 'CLOSED' };

/** tx.$queryRaw answers, in order: the name key, then the duplicate lookup. */
const keyThen = (key: string, duplicate: any = null) => {
  tx.$queryRaw.mockReset();
  tx.$queryRaw.mockResolvedValueOnce([{ k: key }]).mockResolvedValueOnce(duplicate ? [duplicate] : []);
};

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  [tx.$executeRaw, tx.stakeholder.aggregate, tx.stakeholder.create, tx.stakeholder.update].forEach((fn) => fn.mockReset());
  m.transaction.mockImplementation((cb: any) => cb(tx));
  m.districtFindMany.mockResolvedValue([{ name: 'Pune' }, { name: 'Nashik' }]);
  m.auditCreate.mockResolvedValue({});
  tx.$executeRaw.mockResolvedValue(0);
  tx.stakeholder.aggregate.mockResolvedValue({ _max: { primaryKeyId: 100 } });
  tx.stakeholder.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'new1', ...data }));
  invalidateDistrictCache();
});

describe('creating a stakeholder', () => {
  it('creates it when no one in the district has the name, in canonical district spelling', async () => {
    keyThen('almizan');
    const created: any = await service.createStakeholder({ companyNameStandardized: 'Al Mizan', district: 'pune ' }, admin);
    expect(created).toMatchObject({ id: 'new1', district: 'Pune', primaryKeyId: 101, dataSource: 'MANUAL', status: 'OPEN' });
    expect(m.auditCreate).toHaveBeenCalledTimes(1);
  });

  it('refuses a duplicate, creates nothing, and writes no audit', async () => {
    keyThen('almizan', EXISTING);
    await expect(service.createStakeholder({ companyNameStandardized: 'AL MIZAN', district: 'Pune' }, admin)).rejects.toMatchObject({
      statusCode: 409,
      code: 'DUPLICATE_STAKEHOLDER',
    });
    expect(tx.stakeholder.create).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it('names the existing record for an admin', async () => {
    keyThen('almizan', EXISTING);
    const err: any = await service.createStakeholder({ companyNameStandardized: 'x', district: 'Pune' }, admin).catch((e) => e);
    expect(err.message).toBe('A business named "AL- MIZAN" already exists in Pune (Pune City)');
    expect(err.errors[0]).toMatchObject({ field: 'companyNameStandardized', existing: { id: 's-old', status: 'CLOSED', pinCode: '411001' } });
  });

  it('does not give a field enumerator the id or status of the record', async () => {
    keyThen('almizan', EXISTING);
    const err: any = await service.createStakeholder({ companyNameStandardized: 'x', district: 'Pune' }, enumerator).catch((e) => e);
    expect(err.errors[0].existing).toEqual({ name: 'AL- MIZAN', district: 'Pune', city: 'Pune City' });
  });

  it('shows a district admin the record, like a full admin', async () => {
    keyThen('almizan', EXISTING);
    const err: any = await service
      .createStakeholder({ companyNameStandardized: 'x', district: 'Pune' }, { id: 'd1', districts: ['Pune'], isAdmin: false, isDistrictAdmin: true })
      .catch((e) => e);
    expect(err.errors[0].existing.id).toBe('s-old');
  });

  it('takes the name lock before checking and the id lock before allocating', async () => {
    keyThen('almizan');
    await service.createStakeholder({ companyNameStandardized: 'Al Mizan', district: 'Pune' }, admin);
    const lockValues = tx.$executeRaw.mock.calls.map((c: any[]) => c[0].values);
    expect(lockValues[0]).toEqual([3, 'almizan|pune']);
    expect(lockValues[1]).toEqual([4, 'primary_key_id']);
  });

  it('rejects a name with no letters or digits, before locking or inserting', async () => {
    tx.$queryRaw.mockReset();
    tx.$queryRaw.mockResolvedValueOnce([{ k: '' }]);
    await expect(service.createStakeholder({ companyNameStandardized: '!!! --', district: 'Pune' }, admin)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.stakeholder.create).not.toHaveBeenCalled();
  });

  it('still refuses a district the enumerator is not assigned to', async () => {
    await expect(service.createStakeholder({ companyNameStandardized: 'x', district: 'Nashik' }, enumerator)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('retries from scratch when an id collides, in a new transaction', async () => {
    tx.$queryRaw.mockReset();
    // each attempt: the name key, then the (empty) duplicate lookup
    tx.$queryRaw.mockResolvedValueOnce([{ k: 'almizan' }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ k: 'almizan' }]).mockResolvedValueOnce([]);
    const collision = new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' });
    tx.stakeholder.create.mockRejectedValueOnce(collision);
    const created: any = await service.createStakeholder({ companyNameStandardized: 'Al Mizan', district: 'Pune' }, admin);
    expect(created.id).toBe('new1');
    expect(m.transaction).toHaveBeenCalledTimes(2);
  });

  it('does not retry or fail when only the audit write fails after the commit', async () => {
    keyThen('almizan');
    m.auditCreate.mockRejectedValue(new Error('audit down'));
    await expect(service.createStakeholder({ companyNameStandardized: 'Al Mizan', district: 'Pune' }, admin)).resolves.toMatchObject({ id: 'new1' });
    expect(tx.stakeholder.create).toHaveBeenCalledTimes(1);
  });

  it('lets a duplicate-name refusal through instead of retrying it', async () => {
    keyThen('almizan', EXISTING);
    await service.createStakeholder({ companyNameStandardized: 'x', district: 'Pune' }, admin).catch(() => undefined);
    expect(m.transaction).toHaveBeenCalledTimes(1);
  });
});

describe('renaming a stakeholder', () => {
  const stakeholder = { id: 's1', district: 'Pune', companyNameStandardized: 'Al Mizan', companyNameOriginal: null, lockedById: null };

  beforeEach(() => {
    m.stakeholderFindUnique.mockResolvedValue(stakeholder);
    m.stakeholderUpdate.mockImplementation(({ data }: any) => Promise.resolve({ ...stakeholder, ...data }));
    tx.stakeholder.update.mockImplementation(({ data }: any) => Promise.resolve({ ...stakeholder, ...data }));
  });

  const keys = (newKey: string, oldKey: string) => m.queryRaw.mockResolvedValueOnce([{ newKey, oldKey }]);

  it('is allowed without a check when only capitals or spacing change (same key)', async () => {
    keys('almizan', 'almizan');
    await service.updateStakeholder('s1', { companyNameStandardized: 'AL  MIZAN' }, 'e1');
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.stakeholderUpdate).toHaveBeenCalledTimes(1);
  });

  it('is refused when the new name is already taken in that district, and nothing is saved', async () => {
    keys('hotelsai', 'almizan');
    tx.$queryRaw.mockReset();
    tx.$queryRaw.mockResolvedValueOnce([{ ...EXISTING, name: 'HOTEL SAI' }]);
    await expect(service.updateStakeholder('s1', { companyNameStandardized: 'Hotel Sai' }, 'e1', { staff: true })).rejects.toMatchObject({
      code: 'DUPLICATE_STAKEHOLDER',
    });
    expect(tx.stakeholder.update).not.toHaveBeenCalled();
  });

  it('excludes the record itself and uses its own district', async () => {
    keys('hotelsai', 'almizan');
    tx.$queryRaw.mockReset();
    tx.$queryRaw.mockResolvedValueOnce([]);
    await service.updateStakeholder('s1', { companyNameStandardized: 'Hotel Sai' }, 'e1');
    const lookup = tx.$queryRaw.mock.calls[0][0];
    expect(lookup.values).toEqual(expect.arrayContaining(['hotelsai', 'Pune', 's1']));
    expect(tx.stakeholder.update).toHaveBeenCalledTimes(1);
  });

  it('rejects a blank name and one with no letters or digits', async () => {
    await expect(service.updateStakeholder('s1', { companyNameStandardized: '   ' }, 'e1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    keys('', 'almizan');
    await expect(service.updateStakeholder('s1', { companyNameStandardized: '---' }, 'e1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('does not check anything when the name is not being changed, so duplicated imports stay editable', async () => {
    await service.updateStakeholder('s1', { city: 'New city' }, 'e1');
    expect(m.queryRaw).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });
});

describe('name suggestions', () => {
  const sqlOf = (call: any[]) => (call[0] as Prisma.Sql).sql;
  const valuesOf = (call: any[]) => (call[0] as Prisma.Sql).values;

  it('builds the query from what was typed', () => {
    expect(buildSuggestQuery('  Al   Mizan ', 5)).toMatchObject({ q: 'Al Mizan', limit: 5, prefixPattern: 'al mizan%', containsPattern: '%Al Mizan%' });
  });

  it('returns nothing for input that is too short or not text', () => {
    expect(buildSuggestQuery('a', 8)).toBeNull();
    expect(buildSuggestQuery('  ', 8)).toBeNull();
    expect(buildSuggestQuery(undefined, 8)).toBeNull();
    expect(buildSuggestQuery(['ab'], 8)).toBeNull();
  });

  it('uses the prefix search alone for two characters, and adds "contains" from three', () => {
    expect(buildSuggestQuery('ab', 8)!.containsPattern).toBeNull();
    expect(buildSuggestQuery('abc', 8)!.containsPattern).toBe('%abc%');
  });

  it('caps the length of the text and the number of results', () => {
    expect(buildSuggestQuery('x'.repeat(500), 8)!.q).toHaveLength(100);
    expect(buildSuggestQuery('abc', 999)!.limit).toBe(10);
    expect(buildSuggestQuery('abc', 0)!.limit).toBe(1);
    expect(buildSuggestQuery('abc', 'nope')!.limit).toBe(8);
  });

  it('matches wildcard characters literally', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(buildSuggestQuery('50%_off', 8)!.containsPattern).toBe('%50\\%\\_off%');
  });

  it('runs one query, with the contains branch only when it can use the index', async () => {
    m.queryRaw.mockResolvedValue([]);
    await service.suggest(buildSuggestQuery('ab', 8)!, null);
    expect(sqlOf(m.queryRaw.mock.calls[0])).not.toContain('ILIKE');
    await service.suggest(buildSuggestQuery('abc', 8)!, null);
    expect(sqlOf(m.queryRaw.mock.calls[1])).toContain('ILIKE');
    expect(m.queryRaw).toHaveBeenCalledTimes(2);
  });

  it('is unscoped for a full admin and limited to the given districts otherwise', async () => {
    m.queryRaw.mockResolvedValue([]);
    await service.suggest(buildSuggestQuery('abc', 8)!, null);
    expect(sqlOf(m.queryRaw.mock.calls[0])).not.toContain('btrim(district)) IN');
    await service.suggest(buildSuggestQuery('abc', 8)!, [' Pune ', 'THANE']);
    expect(sqlOf(m.queryRaw.mock.calls[1])).toContain('btrim(district)) IN');
    expect(valuesOf(m.queryRaw.mock.calls[1])).toEqual(expect.arrayContaining(['pune', 'thane']));
  });

  it('returns nothing, without querying, for someone with no districts', async () => {
    await expect(service.suggest(buildSuggestQuery('abc', 8)!, [])).resolves.toEqual({ suggestions: [], exactMatch: null });
    expect(m.queryRaw).not.toHaveBeenCalled();
  });

  it('returns only the fields the form needs', async () => {
    m.queryRaw.mockResolvedValue([{ id: 'x', name: 'AL MIZAN', city: 'Pune', district: 'Pune', pinCode: '1', status: 'OPEN', nameKeyEquals: true, original: 'secret', rank: 1 }]);
    const result = await service.suggest(buildSuggestQuery('al m', 8)!, null);
    expect(result.suggestions).toEqual([{ id: 'x', name: 'AL MIZAN', city: 'Pune', district: 'Pune', pinCode: '1', status: 'OPEN', nameKeyEquals: true }]);
    expect(result.exactMatch).toBeNull();
  });

  describe('the exact same-name record in the chosen district', () => {
    const exactRow = { id: 's-old', name: 'AL MIZAN', city: 'Pune City', district: 'Pune', pinCode: '411001', status: 'CLOSED' };
    // Answer by what the query IS, not by the order the two run in.
    const answerExactWith = (row: any) =>
      m.queryRaw.mockImplementation((q: Prisma.Sql) => Promise.resolve(q.sql.includes("<> ''") ? (row ? [row] : []) : []));
    const exactCall = () => m.queryRaw.mock.calls.map((c: any[]) => c[0] as Prisma.Sql).find((q) => q.sql.includes("<> ''"))!;

    it('is looked up separately, so it cannot be hidden by a crowded, alphabetical list', async () => {
      answerExactWith(exactRow);
      const result = await service.suggest(buildSuggestQuery('al mizan', 8)!, null, ' pune ');
      expect(m.queryRaw).toHaveBeenCalledTimes(2);
      expect(result.exactMatch).toEqual(exactRow);
      expect(exactCall().sql).toContain("<> ''"); // a name of only punctuation never matches nameless records
      expect(exactCall().values).toContain('pune');
    });

    it('is not looked up when no district has been chosen yet', async () => {
      m.queryRaw.mockResolvedValue([]);
      const result = await service.suggest(buildSuggestQuery('al mizan', 8)!, null);
      expect(m.queryRaw).toHaveBeenCalledTimes(1);
      expect(result.exactMatch).toBeNull();
    });

    it('lets a district admin ask about their own district', async () => {
      answerExactWith(exactRow);
      const result = await service.suggest(buildSuggestQuery('al mizan', 8)!, ['Pune', 'Thane'], 'PUNE');
      expect(result.exactMatch).toMatchObject({ id: 's-old' });
    });

    it('will not tell a district admin about a district they are not assigned to', async () => {
      m.queryRaw.mockResolvedValue([]);
      const result = await service.suggest(buildSuggestQuery('al mizan', 8)!, ['Thane'], 'Pune');
      expect(m.queryRaw).toHaveBeenCalledTimes(1); // only the suggestions, never the exact lookup
      expect(result.exactMatch).toBeNull();
    });
  });
});

describe('the suggestions endpoint', () => {
  const controller = new StakeholderController();
  const run = async (enumeratorFlags: any, query: any) => {
    const res: any = { json: jest.fn() };
    const next = jest.fn();
    await controller.suggest({ enumerator: { id: 'u', districts: ['Pune'], ...enumeratorFlags }, query } as any, res, next);
    return { res, next };
  };

  it('is closed to field enumerators', async () => {
    const { next, res } = await run({ isAdmin: false, isDistrictAdmin: false }, { q: 'abc' });
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
    expect(res.json).not.toHaveBeenCalled();
    expect(m.queryRaw).not.toHaveBeenCalled();
  });

  it('answers an empty list, not an error, for text that is too short', async () => {
    const { res } = await run({ isAdmin: true }, { q: 'a' });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { suggestions: [], exactMatch: null } });
    expect(m.queryRaw).not.toHaveBeenCalled();
  });

  it('scopes a district admin to their districts and leaves a full admin unscoped', async () => {
    m.queryRaw.mockResolvedValue([]);
    await run({ isAdmin: false, isDistrictAdmin: true }, { q: 'abc' });
    expect(valuesOf(m.queryRaw.mock.calls[0])).toContain('pune');
    m.queryRaw.mockClear();
    await run({ isAdmin: true }, { q: 'abc' });
    expect(sqlOf(m.queryRaw.mock.calls[0])).not.toContain('btrim(district)) IN');
  });

  function valuesOf(call: any[]) { return (call[0] as Prisma.Sql).values; }
  function sqlOf(call: any[]) { return (call[0] as Prisma.Sql).sql; }
});
