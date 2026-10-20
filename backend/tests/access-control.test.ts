const mockSurveyFindMany = jest.fn();
const mockRevocationFindMany = jest.fn();

jest.mock('../src/config/database', () => ({
  prisma: {
    survey: { findMany: (...a: any[]) => mockSurveyFindMany(...a) },
    stakeholderRevocation: { findMany: (...a: any[]) => mockRevocationFindMany(...a) },
  },
}));

import { assertAccessOrOwnWork } from '../src/utils/access-control';

const stakeholder = { id: 's1', district: 'Pune' };

beforeEach(() => {
  mockSurveyFindMany.mockReset().mockResolvedValue([]);
  mockRevocationFindMany.mockReset().mockResolvedValue([]);
});

describe('assertAccessOrOwnWork', () => {
  it('lets an enumerator work in their own district without touching the database', async () => {
    await expect(assertAccessOrOwnWork(stakeholder, ['Pune'], false, 'e1')).resolves.toBeUndefined();
    expect(mockSurveyFindMany).not.toHaveBeenCalled();
  });

  it('lets an admin through', async () => {
    await expect(assertAccessOrOwnWork(stakeholder, [], true, 'a1')).resolves.toBeUndefined();
  });

  it('refuses a record outside their districts when they have no work on it', async () => {
    await expect(assertAccessOrOwnWork(stakeholder, ['Nashik'], false, 'e1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('allows a record outside their districts when they already have a survey on it', async () => {
    mockSurveyFindMany.mockResolvedValue([{ stakeholderId: 's1' }]);
    await expect(assertAccessOrOwnWork(stakeholder, ['Nashik'], false, 'e1')).resolves.toBeUndefined();
  });

  it('allows a record outside their districts when the claim was taken back from them', async () => {
    mockRevocationFindMany.mockResolvedValue([{ stakeholderId: 's1' }]);
    await expect(assertAccessOrOwnWork(stakeholder, ['Nashik'], false, 'e1')).resolves.toBeUndefined();
  });

  it("does not let one enumerator's work open the record to another", async () => {
    await expect(assertAccessOrOwnWork(stakeholder, ['Nashik'], false, 'e2')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mockSurveyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ enumeratorId: 'e2' }) }),
    );
  });
});
