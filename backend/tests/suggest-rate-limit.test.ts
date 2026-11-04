jest.mock('../src/config', () => ({
  config: { env: 'test', logging: { level: 'silent' }, rateLimit: { windowMs: 60000, maxRequests: 3, loginMax: 5 } },
}));

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { SUGGEST_PATH } from '../src/middleware/rate-limiter';

function startApp(): Promise<{ server: http.Server; get: (path: string) => Promise<number> }> {
  // Fresh limiter instances per test: they keep their counts in memory, and a shared one would
  // carry requests from one test into the next.
  let limiters: typeof import('../src/middleware/rate-limiter') = undefined as any;
  jest.isolateModules(() => { limiters = require('../src/middleware/rate-limiter'); });
  const { generalLimiter, suggestLimiter } = limiters;
  const app = express();
  app.use(generalLimiter);
  app.get('/api/stakeholders/suggest', (req, _res, next) => { (req as any).enumerator = { id: (req.query.as as string) || 'u1' }; next(); }, suggestLimiter, (_req, res) => res.json({ ok: true }));
  app.get('/api/other', (_req, res) => res.json({ ok: true }));
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      const get = (p: string) => new Promise<number>((done) => http.get({ port, path: p }, (r) => { r.resume(); done(r.statusCode || 0); }));
      resolve({ server, get });
    });
  });
}

describe('rate limiting for the suggestions endpoint', () => {
  it('knows the path it exempts', () => {
    expect(SUGGEST_PATH).toBe('/api/stakeholders/suggest');
  });

  it('is not counted against the general limit, so typing cannot lock a user out of everything else', async () => {
    const { server, get } = await startApp();
    try {
      const suggest: number[] = [];
      for (let i = 0; i < 10; i++) suggest.push(await get('/api/stakeholders/suggest?q=abc&as=a'));
      expect(suggest.every((s) => s === 200)).toBe(true); // far past the general limit of 3
      expect(await get('/api/other')).toBe(200); // and the general allowance is untouched
    } finally {
      server.close();
    }
  });

  it('still applies the general limit to every other route', async () => {
    const { server, get } = await startApp();
    try {
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push(await get('/api/other'));
      expect(codes).toEqual([200, 200, 200, 429, 429]);
    } finally {
      server.close();
    }
  });

  it('also exempts the same path with a trailing slash', async () => {
    const { server, get } = await startApp();
    try {
      for (let i = 0; i < 6; i++) expect(await get('/api/stakeholders/suggest/?q=abc&as=b')).toBe(200);
    } finally {
      server.close();
    }
  });
});
