import { intEnv, boolEnv, listEnv } from '../src/utils/env';

const KEY = 'TEST_ENV_VALUE';
afterEach(() => { delete process.env[KEY]; });

describe('intEnv', () => {
  it('uses the fallback when unset', () => {
    expect(intEnv(KEY, 14)).toBe(14);
  });
  it('reads a positive whole number', () => {
    process.env[KEY] = '30';
    expect(intEnv(KEY, 14)).toBe(30);
  });
  it.each(['abc', '0', '-5', '2.5', ''])('falls back on invalid value %p', (v) => {
    process.env[KEY] = v;
    expect(intEnv(KEY, 14)).toBe(14);
  });
});

describe('boolEnv', () => {
  it('uses the fallback when unset or unrecognised', () => {
    expect(boolEnv(KEY, true)).toBe(true);
    process.env[KEY] = 'maybe';
    expect(boolEnv(KEY, false)).toBe(false);
  });
  it.each([['true', true], ['1', true], ['TRUE', true], ['false', false], ['0', false], [' False ', false]])(
    'reads %p as %p',
    (v, expected) => {
      process.env[KEY] = v;
      expect(boolEnv(KEY, !expected)).toBe(expected);
    },
  );
});

describe('listEnv', () => {
  it('is null when unset or empty', () => {
    expect(listEnv(KEY)).toBeNull();
    process.env[KEY] = ' , ';
    expect(listEnv(KEY)).toBeNull();
  });
  it('splits on commas, trims, and drops trailing slashes', () => {
    process.env[KEY] = 'https://a.example.com/, https://b.example.com ,http://localhost:5173';
    expect(listEnv(KEY)).toEqual(['https://a.example.com', 'https://b.example.com', 'http://localhost:5173']);
  });
});
