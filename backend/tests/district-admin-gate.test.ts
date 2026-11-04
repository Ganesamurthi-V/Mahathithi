jest.mock('../src/config/database', () => ({ prisma: new Proxy({}, { get: () => new Proxy(() => undefined, { get: () => jest.fn() }) }) }));
jest.mock('../src/config', () => ({
  config: { env: 'test', logging: { level: 'silent' }, aws: { s3PublicBaseUrl: 'https://x' }, jwt: { secret: 's'.repeat(40) } },
}));
jest.mock('../src/realtime/socket', () => ({ emitToDistrictAndAdmins: jest.fn() }));
jest.mock('../src/realtime/events', () => ({ broadcastChange: jest.fn(), notifyEnumerator: jest.fn() }));
jest.mock('../src/config/storage', () => ({ uploadToS3: jest.fn(), getPresignedUrl: jest.fn(), deleteFromS3: jest.fn(), generateS3Key: jest.fn() }));

import adminRouter from '../src/modules/admin/admin.routes';
import { isAllowedForDistrictAdmin, districtAdminGate, denyDistrictAdmin } from '../src/middleware/district-admin-gate';
import { adminOnly, staffOnly } from '../src/middleware/auth';

interface RouteInfo { method: string; path: string; concrete: string }

// Every route the real admin router registers, straight from the router itself.
function registeredRoutes(): RouteInfo[] {
  const out: RouteInfo[] = [];
  for (const layer of (adminRouter as any).stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      out.push({ method: method.toUpperCase(), path: layer.route.path, concrete: String(layer.route.path).replace(/:[A-Za-z]+/g, 'x1') });
    }
  }
  return out;
}

const run = (mw: any, req: any) => { const next = jest.fn(); mw(req, {}, next); return next; };
const districtAdmin = { id: 'da', isAdmin: false, isDistrictAdmin: true, districts: ['Pune'] };
const fullAdmin = { id: 'a', isAdmin: true, isDistrictAdmin: false, districts: [] };
const fieldWorker = { id: 'e', isAdmin: false, isDistrictAdmin: false, districts: ['Pune'] };

describe('the district admin allowlist, checked against the real admin router', () => {
  const routes = registeredRoutes();
  const reachable = routes.filter((r) => isAllowedForDistrictAdmin(r.method, r.concrete)).map((r) => `${r.method} ${r.path}`).sort();

  it('finds the admin routes', () => {
    expect(routes.length).toBeGreaterThan(15);
  });

  it('lets a district admin reach exactly the intended routes and nothing else', () => {
    expect(reachable).toEqual([
      'GET /analytics',
      'GET /districts',
      'GET /export/surveys',
      'GET /export/surveys/list',
      'GET /export/sync-status',
      'GET /surveys/review',
      'PATCH /surveys/:id',
      'POST /export/surveys',
      'POST /stakeholders/:id/take-survey',
      'POST /surveys/:id/finalize',
      'POST /surveys/:id/review/resolve',
    ].sort());
  });

  it('refuses every other admin route, including everything that deletes or manages accounts', () => {
    const refused = routes.filter((r) => !isAllowedForDistrictAdmin(r.method, r.concrete)).map((r) => `${r.method} ${r.path}`);
    for (const must of [
      'DELETE /enumerators/:id',
      'POST /enumerators',
      'PATCH /enumerators/:id',
      'PUT /enumerators/:id/districts',
      'GET /enumerators',
      'GET /audit-logs',
      'POST /stakeholders/rebalance',
    ]) {
      expect(refused).toContain(must);
    }
    for (const r of routes.filter((x) => x.method === 'DELETE')) {
      expect(isAllowedForDistrictAdmin(r.method, r.concrete)).toBe(false);
    }
  });

  it('actually blocks each refused route through the gate middleware (403), and passes the allowed ones', () => {
    for (const r of routes) {
      const next = run(districtAdminGate, { enumerator: districtAdmin, method: r.method, path: r.concrete });
      const allowed = isAllowedForDistrictAdmin(r.method, r.concrete);
      if (allowed) expect(next).toHaveBeenCalledWith();
      else expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
    }
  });

  it('never restricts a full admin', () => {
    for (const r of routes) {
      expect(run(districtAdminGate, { enumerator: fullAdmin, method: r.method, path: r.concrete })).toHaveBeenCalledWith();
    }
  });
});

describe('the gate matches paths strictly', () => {
  it.each([
    ['GET', '/analytics/', true],               // trailing slash is the same route
    ['GET', '/Analytics', false],               // different case: refused, never allowed
    ['GET', '/analytics/extra', false],
    ['GET', '/surveys/x1', false],              // only PATCH is allowed on a survey
    ['DELETE', '/surveys/x1', false],
    ['POST', '/surveys/x1/finalize/extra', false],
    ['POST', '/surveys/a/b/finalize', false],   // an id cannot contain a slash
    ['PATCH', '/surveys/x1', true],
    ['PUT', '/analytics', false],
    ['GET', '/export/surveys/list/', true],
    ['GET', '/enumerators', false],
    ['GET', '/', false],
  ])('%s %s -> %s', (method, path, expected) => {
    expect(isAllowedForDistrictAdmin(method as string, path as string)).toBe(expected);
  });
});

describe('role middleware', () => {
  it('adminOnly answers 403, not 401, so the panel does not sign the person out', () => {
    expect(run(adminOnly, { enumerator: districtAdmin }).mock.calls[0][0]).toMatchObject({ statusCode: 403 });
    expect(run(adminOnly, { enumerator: fieldWorker }).mock.calls[0][0]).toMatchObject({ statusCode: 403 });
    expect(run(adminOnly, { enumerator: fullAdmin })).toHaveBeenCalledWith();
  });

  it('staffOnly admits both kinds of admin and no one else', () => {
    expect(run(staffOnly, { enumerator: fullAdmin })).toHaveBeenCalledWith();
    expect(run(staffOnly, { enumerator: districtAdmin })).toHaveBeenCalledWith();
    expect(run(staffOnly, { enumerator: fieldWorker }).mock.calls[0][0]).toMatchObject({ statusCode: 403 });
    expect(run(staffOnly, {}).mock.calls[0][0]).toMatchObject({ statusCode: 403 });
  });

  it('field-device routes are closed to a district admin but open to everyone else', () => {
    expect(run(denyDistrictAdmin, { enumerator: districtAdmin }).mock.calls[0][0]).toMatchObject({ statusCode: 403 });
    expect(run(denyDistrictAdmin, { enumerator: fieldWorker })).toHaveBeenCalledWith();
    expect(run(denyDistrictAdmin, { enumerator: fullAdmin })).toHaveBeenCalledWith();
  });
});
