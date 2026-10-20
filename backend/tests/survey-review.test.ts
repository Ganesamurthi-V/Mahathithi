const m = {
  surveyFindUnique: jest.fn(),
  surveyFindUniqueOrThrow: jest.fn(),
  surveyUpdate: jest.fn(),
  auditCreate: jest.fn(),
  revocationFindMany: jest.fn(),
  surveyFindMany: jest.fn(),
  transaction: jest.fn(),
  stakeholderFindUnique: jest.fn(),
  surveyUpsert: jest.fn(),
};

jest.mock('../src/config/database', () => ({
  prisma: {
    survey: {
      findUnique: (...a: any[]) => m.surveyFindUnique(...a),
      findUniqueOrThrow: (...a: any[]) => m.surveyFindUniqueOrThrow(...a),
      findMany: (...a: any[]) => m.surveyFindMany(...a),
      update: (...a: any[]) => m.surveyUpdate(...a),
      upsert: (...a: any[]) => m.surveyUpsert(...a),
    },
    stakeholder: { findUnique: (...a: any[]) => m.stakeholderFindUnique(...a), update: jest.fn() },
    stakeholderRevocation: { findMany: (...a: any[]) => m.revocationFindMany(...a), create: jest.fn() },
    auditLog: { create: (...a: any[]) => m.auditCreate(...a) },
    $transaction: (...a: any[]) => m.transaction(...a),
  },
}));
jest.mock('../src/config', () => ({ config: { env: 'test', logging: { level: 'silent' } } }));
jest.mock('../src/realtime/socket', () => ({ emitToDistrictAndAdmins: jest.fn() }));
jest.mock('../src/realtime/events', () => ({ broadcastChange: jest.fn() }));

import { flagForReview } from '../src/utils/survey-review';
import { SurveyService } from '../src/modules/survey/survey.service';

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.surveyUpdate.mockResolvedValue({});
  m.auditCreate.mockResolvedValue({});
  m.revocationFindMany.mockResolvedValue([]);
  m.surveyFindMany.mockResolvedValue([]);
  m.transaction.mockResolvedValue([]);
});

describe('flagForReview', () => {
  it('flags a survey and writes an audit entry', async () => {
    m.surveyFindUnique.mockResolvedValue({ reviewReason: null, needsReview: false, stakeholderId: 's1' });
    await flagForReview('sv1', 'GPS is far', 'e1');
    expect(m.surveyUpdate).toHaveBeenCalledWith({
      where: { id: 'sv1' },
      data: { needsReview: true, reviewReason: 'GPS is far' },
    });
    expect(m.auditCreate).toHaveBeenCalledTimes(1);
  });

  it('keeps every reason a survey was flagged for', async () => {
    m.surveyFindUnique.mockResolvedValue({ reviewReason: 'GPS is far', needsReview: true, stakeholderId: 's1' });
    await flagForReview('sv1', 'Arrived after completion', 'e1');
    expect(m.surveyUpdate).toHaveBeenCalledWith({
      where: { id: 'sv1' },
      data: { needsReview: true, reviewReason: 'GPS is far | Arrived after completion' },
    });
  });

  it('does nothing when the same reason is already recorded (a retried upload)', async () => {
    m.surveyFindUnique.mockResolvedValue({ reviewReason: 'GPS is far', needsReview: true, stakeholderId: 's1' });
    await flagForReview('sv1', 'GPS is far', 'e1');
    expect(m.surveyUpdate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
});

describe('completeSurvey', () => {
  const service = new SurveyService();
  const baseSurvey = (stakeholder: any) => ({
    id: 'sv1',
    enumeratorId: 'e1',
    stakeholderId: 's1',
    aadharNumber: '123412341234',
    udyamAadharRegNo: null,
    latitude: 18.9,
    longitude: 73.9,
    media: [],
    stakeholder: { id: 's1', district: 'Pune', latitude: 18.5204, longitude: 73.8567, assignedToId: 'e1', lockedById: null, ...stakeholder },
  });

  it('does not let a late survey take the lock from whoever completed the record first', async () => {
    m.surveyFindUnique
      .mockResolvedValueOnce(baseSurvey({ lockedById: 'admin1' }))
      .mockResolvedValue({ reviewReason: null, needsReview: false, stakeholderId: 's1' });

    const result = await service.completeSurvey('sv1', 'e1', ['Pune'], false);

    expect(result.status).toBe('UNDER_REVIEW');
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.surveyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ needsReview: true }) }),
    );
  });

  it('completes normally and flags a survey taken 40 km from the business', async () => {
    m.surveyFindUnique
      .mockResolvedValueOnce(baseSurvey({}))
      .mockResolvedValue({ reviewReason: null, needsReview: false, stakeholderId: 's1' });

    const result = await service.completeSurvey('sv1', 'e1', ['Pune'], false);

    expect(result.status).toBe('CLOSED');
    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(m.surveyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ needsReview: true, reviewReason: expect.stringContaining('km from the business') }) }),
    );
  });

  it('completes without a flag when the survey was taken at the business', async () => {
    m.surveyFindUnique.mockResolvedValueOnce({ ...baseSurvey({}), latitude: 18.5206, longitude: 73.8569 });

    const result = await service.completeSurvey('sv1', 'e1', ['Pune'], false);

    expect(result.status).toBe('CLOSED');
    expect(m.surveyUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ needsReview: true }) }),
    );
  });
});

describe('createOrUpdate with an admin edit', () => {
  const service = new SurveyService();

  it('ignores a phone upload once an admin has edited the survey', async () => {
    m.stakeholderFindUnique.mockResolvedValue({ id: 's1', district: 'Pune', lockedById: null });
    m.surveyFindUnique.mockResolvedValue({ id: 'sv1', adminEditedAt: new Date() });
    m.surveyFindUniqueOrThrow.mockResolvedValue({ id: 'sv1', businessName: 'Admin corrected name' });

    const result: any = await service.createOrUpdate(
      { stakeholderId: 's1', enumeratorId: 'e1', businessName: 'Phone value' } as any,
      ['Pune'],
      false,
    );

    expect(result.businessName).toBe('Admin corrected name');
    expect(m.surveyUpsert).not.toHaveBeenCalled();
  });
});
