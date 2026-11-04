// A district admin: staff limited to their districts, who may not delete anything.

const m = {
  stakeholderFindUnique: jest.fn(),
  stakeholderFindMany: jest.fn(),
  stakeholderCount: jest.fn(),
  stakeholderUpdate: jest.fn(),
  surveyFindUnique: jest.fn(),
  surveyFindMany: jest.fn(),
  surveyUpdate: jest.fn(),
  surveyCreate: jest.fn(),
  surveyCount: jest.fn(),
  auditCreate: jest.fn(),
  districtFindMany: jest.fn(),
  transaction: jest.fn(),
};

jest.mock('../src/config/database', () => ({
  prisma: {
    stakeholder: {
      findUnique: (...a: any[]) => m.stakeholderFindUnique(...a),
      findMany: (...a: any[]) => m.stakeholderFindMany(...a),
      count: (...a: any[]) => m.stakeholderCount(...a),
      update: (...a: any[]) => m.stakeholderUpdate(...a),
    },
    survey: {
      findUnique: (...a: any[]) => m.surveyFindUnique(...a),
      findMany: (...a: any[]) => m.surveyFindMany(...a),
      update: (...a: any[]) => m.surveyUpdate(...a),
      create: (...a: any[]) => m.surveyCreate(...a),
      count: (...a: any[]) => m.surveyCount(...a),
    },
    stakeholderRevocation: { findMany: jest.fn().mockResolvedValue([]) },
    district: { findMany: (...a: any[]) => m.districtFindMany(...a) },
    auditLog: { create: (...a: any[]) => m.auditCreate(...a) },
    $transaction: (...a: any[]) => m.transaction(...a),
  },
}));
jest.mock('../src/config', () => ({ config: { env: 'test', logging: { level: 'silent' } } }));
jest.mock('../src/realtime/socket', () => ({ emitToDistrictAndAdmins: jest.fn() }));
jest.mock('../src/realtime/events', () => ({ broadcastChange: jest.fn() }));
jest.mock('../src/utils/category-scope', () => ({ categoryFilter: jest.fn().mockResolvedValue(null) }));

import { SurveyService } from '../src/modules/survey/survey.service';
import { StakeholderService } from '../src/modules/stakeholder/stakeholder.service';
import { createEnumeratorSchema, updateEnumeratorSchema } from '../src/schemas/request-schemas';
import { isStaff, isScopedStaff } from '../src/utils/roles';

const PUNE = ['Pune'];
const IN_PUNE = { id: 's1', district: 'Pune', status: 'OPEN', surveys: [], digipin: null, latitude: null, longitude: null };
const IN_NASHIK = { ...IN_PUNE, id: 's2', district: 'Nashik' };

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.districtFindMany.mockResolvedValue([]);
  m.auditCreate.mockResolvedValue({});
  m.surveyUpdate.mockResolvedValue({ id: 'sv1' });
  m.surveyCreate.mockResolvedValue({ id: 'sv1' });
  m.stakeholderFindMany.mockResolvedValue([]);
  m.stakeholderCount.mockResolvedValue(0);
  m.transaction.mockResolvedValue([]);
});

describe('role helpers', () => {
  it('tells the three kinds of account apart', () => {
    expect(isStaff({ isAdmin: true })).toBe(true);
    expect(isStaff({ isDistrictAdmin: true })).toBe(true);
    expect(isStaff({})).toBe(false);
    expect(isScopedStaff({ isDistrictAdmin: true })).toBe(true);
    expect(isScopedStaff({ isAdmin: true })).toBe(false);
    expect(isScopedStaff({ isAdmin: true, isDistrictAdmin: true })).toBe(false); // admin wins, never narrower
    expect(isScopedStaff(undefined)).toBe(false);
  });
});

describe('creating the account', () => {
  const base = { loginId: 'da', password: 'Passw0rd!x', name: 'D A' };
  const id = '3f2b8a52-6a43-4d0a-9d0f-0e1f9b1a2c3d';

  it('accepts a district admin with a district', () => {
    expect(createEnumeratorSchema.safeParse({ ...base, isDistrictAdmin: true, districtIds: [id] }).success).toBe(true);
  });
  it('requires at least one district', () => {
    expect(createEnumeratorSchema.safeParse({ ...base, isDistrictAdmin: true }).success).toBe(false);
    expect(createEnumeratorSchema.safeParse({ ...base, isDistrictAdmin: true, districtIds: [] }).success).toBe(false);
  });
  it('refuses an account that is both kinds of admin', () => {
    expect(createEnumeratorSchema.safeParse({ ...base, isAdmin: true, isDistrictAdmin: true, districtIds: [id] }).success).toBe(false);
  });
  it('leaves ordinary enumerators and full admins unchanged', () => {
    expect(createEnumeratorSchema.safeParse(base).success).toBe(true);
    expect(createEnumeratorSchema.safeParse({ ...base, isAdmin: true }).success).toBe(true);
  });
  it('cannot change an account role afterwards', () => {
    expect(updateEnumeratorSchema.safeParse({ isDistrictAdmin: true }).success).toBe(false);
    expect(updateEnumeratorSchema.safeParse({ isAdmin: true }).success).toBe(false);
    expect(updateEnumeratorSchema.safeParse({ name: 'New name' }).success).toBe(true);
  });
});

describe('survey operations are held to the caller\'s districts', () => {
  const service = new SurveyService();
  const scope = { scope: { districts: PUNE }, actorId: 'da1' };

  it('take survey: in-district works', async () => {
    m.stakeholderFindUnique.mockResolvedValue(IN_PUNE);
    await expect(service.adminCreateSurvey('s1', 'da1', scope)).resolves.toBeDefined();
    expect(m.surveyCreate).toHaveBeenCalledTimes(1);
  });

  it('take survey: another district is refused before anything is written', async () => {
    m.stakeholderFindUnique.mockResolvedValue(IN_NASHIK);
    await expect(service.adminCreateSurvey('s2', 'da1', scope)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(m.surveyCreate).not.toHaveBeenCalled();
  });

  it('take survey: a foreign stakeholder\'s state is not revealed (403, not the 409 for a closed one)', async () => {
    m.stakeholderFindUnique.mockResolvedValue({ ...IN_NASHIK, status: 'CLOSED' });
    await expect(service.adminCreateSurvey('s2', 'da1', scope)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('take survey: an unknown stakeholder is a 404', async () => {
    m.stakeholderFindUnique.mockResolvedValue(null);
    await expect(service.adminCreateSurvey('nope', 'da1', scope)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('take survey: a full admin is not restricted', async () => {
    m.stakeholderFindUnique.mockResolvedValue(IN_NASHIK);
    await expect(service.adminCreateSurvey('s2', 'admin1', { actorId: 'admin1' })).resolves.toBeDefined();
  });

  it('edit survey: another district is refused and nothing is written', async () => {
    m.surveyFindUnique.mockResolvedValue({ id: 'sv9', stakeholderId: 's2', enumeratorId: 'e1', district: 'Nashik', stakeholder: { district: 'Nashik' } });
    await expect(service.adminEditSurvey('sv9', { businessName: 'x' }, scope)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(m.surveyUpdate).not.toHaveBeenCalled();
  });

  it('edit survey: a district admin cannot relabel a survey into another district', async () => {
    m.surveyFindUnique.mockResolvedValue({ id: 'sv1', stakeholderId: 's1', enumeratorId: 'e1', district: 'Pune', stakeholder: { district: 'Pune' } });
    await service.adminEditSurvey('sv1', { businessName: 'Edited', district: 'Nashik' }, scope);
    expect(m.surveyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ businessName: 'Edited', district: 'Pune' }) }),
    );
  });

  it('edit survey: records who did it', async () => {
    m.surveyFindUnique.mockResolvedValue({ id: 'sv1', stakeholderId: 's1', enumeratorId: 'e1', district: 'Pune', stakeholder: { district: 'Pune' } });
    await service.adminEditSurvey('sv1', { businessName: 'Edited' }, scope);
    expect(m.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ details: expect.objectContaining({ actorId: 'da1' }) }) }),
    );
  });

  it('edit survey: a full admin may still change the district field', async () => {
    m.surveyFindUnique.mockResolvedValue({ id: 'sv1', stakeholderId: 's1', enumeratorId: 'e1', district: 'Pune', stakeholder: { district: 'Pune' } });
    await service.adminEditSurvey('sv1', { district: 'Nashik' }, { actorId: 'admin1' });
    expect(m.surveyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ district: 'Nashik' }) }),
    );
  });

  it('finalize: another district is refused and nothing is closed', async () => {
    m.surveyFindUnique.mockResolvedValue({ id: 'sv9', stakeholderId: 's2', enumeratorId: 'e1', aadharNumber: '123412341234', isCompleted: false, stakeholder: IN_NASHIK });
    await expect(service.adminFinalizeSurvey('sv9', scope)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('finalize: in-district completes, and a missing ID number is a 400, not a 500', async () => {
    m.surveyFindUnique.mockResolvedValue({ id: 'sv1', stakeholderId: 's1', enumeratorId: 'e1', aadharNumber: '123412341234', isCompleted: false, stakeholder: IN_PUNE });
    await expect(service.adminFinalizeSurvey('sv1', scope)).resolves.toMatchObject({ status: 'CLOSED' });

    m.surveyFindUnique.mockResolvedValue({ id: 'sv1', stakeholderId: 's1', enumeratorId: 'e1', aadharNumber: '', udyamAadharRegNo: '', isCompleted: false, stakeholder: IN_PUNE });
    await expect(service.adminFinalizeSurvey('sv1', scope)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('what a district admin sees of stakeholders', () => {
  const service = new StakeholderService();
  const closedInPune = { ...IN_PUNE, status: 'CLOSED', surveys: [{ id: 'sv1', enumeratorId: 'other' }], phoneValidations: [], lockedBy: null };

  it('detail: sees a completed record in their district, with every survey on it', async () => {
    m.stakeholderFindUnique.mockResolvedValue(closedInPune);
    await expect(service.getById('s1', 'da1', PUNE, false, true)).resolves.toMatchObject({ id: 's1' });
    const include = m.stakeholderFindUnique.mock.calls[0][0].include;
    expect(include.surveys.where).toBeUndefined(); // not limited to the caller's own surveys
  });

  it('detail: a field enumerator still cannot see a completed record', async () => {
    m.stakeholderFindUnique.mockResolvedValue(closedInPune);
    await expect(service.getById('s1', 'e1', PUNE, false, false)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('detail: a district admin cannot open a record in another district', async () => {
    m.stakeholderFindUnique.mockResolvedValue({ ...closedInPune, district: 'Nashik' });
    await expect(service.getById('s1', 'da1', PUNE, false, true)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  const searchWhere = async (over: any) => {
    m.stakeholderFindMany.mockResolvedValue([]);
    await service.search({ page: 1, limit: 20, assignedDistricts: PUNE, isAdmin: false, ...over });
    return JSON.stringify(m.stakeholderFindMany.mock.calls[0][0].where);
  };

  it('search: a district admin is limited to their districts but is not told to skip completed records', async () => {
    const where = await searchWhere({ isDistrictAdmin: true });
    expect(where).toContain('Pune');
    expect(where).not.toContain('CLOSED');
  });

  it('search: a field enumerator still has completed records filtered out', async () => {
    const where = await searchWhere({ isDistrictAdmin: false });
    expect(where).toContain('CLOSED');
  });

  it('search: a full admin is not limited to districts', async () => {
    const where = await searchWhere({ isAdmin: true });
    expect(where).not.toContain('Pune');
  });
});
