# Real-Time Sync Implementation Plan — MahaAtithi

**Audience:** Antigravity (agentic coding agent) implementing this directly in the repo.
**Author context:** Produced by Claude acting as technical auditor/reviewer for Ganesh, based on a full read of the current codebase (`backend/`, `mobile/`, `admin-panel/`).
**Branch:** Implement on top of `feature/sqlite` (or a new `feature/realtime-sync` branch off it).

---

## 0. Read this first — current state of the codebase

Today there is **no push channel anywhere**. Confirmed by reading the actual code:

- `backend/src/modules/sync/sync.routes.ts` exposes only `POST /sync/upload` and `GET /sync/changes?since=`. Pure request/response, no WebSocket, no SSE.
- `mobile/src/navigation/AppNavigator.tsx` triggers `runAutoSync()` **only** on a debounced `NetInfo.addEventListener` reconnect event (1500ms debounce). There is no `setInterval` anywhere driving periodic sync.
- `admin-panel/src/pages/DashboardPage.tsx` and others use `@tanstack/react-query` with `staleTime: 60000` — data is only refetched on remount/manual navigation, never pushed.
- `backend/package.json` has **no socket.io, no ws, no sse libraries**. `admin-panel/package.json` and `mobile/package.json` likewise have nothing for real-time.
- Redis in this codebase is `@upstash/redis`, the **HTTP REST client** (`backend/src/config/redis.ts`), used only for brute-force login lockout. It is **not** a persistent TCP connection and is not currently used for pub/sub. Do not assume a real-time-ready Redis is already wired up.
- Deployment is a normal long-running Node process on Railway (per `CLAUDE.md` and `docker-compose.yml`), not a serverless/edge function platform — this makes a persistent WebSocket connection viable, which is good.

This plan adds real-time push **on top of** the existing offline-first/poll model, without removing or weakening it. The existing `getChanges` polling endpoint and the SQLite "first-to-sync-wins" conflict resolution remain the source of truth and the fallback for offline periods. Real-time is an **optimization layer**: it makes already-correct state updates arrive faster when a device/admin panel is online, it does not change correctness.

---

## 1. Goal

When enumerator A completes a survey on a stakeholder (locking it `CLOSED`), enumerator B — who may be looking at the same stakeholder in a different district overlap or a shared list — and the admin panel should see that change **within seconds**, not at the next reconnect or next 60s poll.

Concretely, three event types need to go out:

1. **`stakeholder:locked`** — fired the moment a stakeholder gets `status = CLOSED` + `lockedById` set (survey completion). Recipients: enumerators in that stakeholder's district (so they can grey it out / remove it from their local list immediately), plus all admins.
2. **`stakeholder:unlocked`** — fired when an admin deactivates/deletes an enumerator and their locked stakeholders get released back to `OPEN`. Recipients: enumerators in the affected districts, plus admins.
3. **`enumerator:presence`** — fired on socket connect/disconnect. Recipients: admins only (live "who's online" on the dashboard).

Optional but recommended (call out as Phase 2 in the plan, not required for v1): `survey:completed` for live admin analytics counters, separate from `stakeholder:locked` because the admin dashboard cares about counts/throughput, not the district-room semantics enumerators need.

---

## 2. Why Socket.IO, why district-scoped rooms, why in-memory adapter for now

- **Socket.IO** (not raw `ws`, not SSE) because it gives us: automatic reconnect/backoff (mirrors the resilience already built into the mobile sync pipeline — see the SYNC FIX comments in `syncThunks.ts`), room-based broadcast (maps directly onto the existing district-scoping model), and graceful fallback. SSE was considered but rejected because it's one-directional and we may want client→server presence pings later; plain `ws` was considered but rejected because we'd hand-roll reconnect/rooms that Socket.IO already solves well.
- **District-scoped rooms**, not a single global broadcast channel, because the existing security invariant in this codebase is **district-scoped access control** (`backend/src/utils/access-control.ts:assertStakeholderAccess`, called from every stakeholder-scoped module per `CLAUDE.md`). A naive global broadcast would leak which stakeholders are being worked in districts an enumerator isn't assigned to — a real information disclosure regression against the existing access model. Every enumerator socket joins one room per assigned district (`district:<district-name-uppercased>`); admins join a single `admin:global` room and implicitly receive everything.
- **In-memory Socket.IO adapter (default), not the Redis adapter, for v1** — because this app currently runs as a single Railway service/instance. The in-memory adapter only works correctly with one Node process; if this app is ever scaled horizontally (multiple Railway replicas / multiple dynos), broadcasts from a socket connected to instance A will never reach a socket connected to instance B, and this silently breaks real-time delivery while everything else keeps working (a nasty bug to debug later). **This plan includes the exact upgrade path** (Section 7) to swap in `@socket.io/redis-adapter` later — note Upstash's REST client (`@upstash/redis`) cannot back this adapter; you'd need a TCP-capable Redis (e.g. `ioredis` against a Redis URL, which Upstash also offers alongside its REST API) — but do **not** implement the Redis adapter in this pass unless explicitly told the deployment is multi-instance.

---

## 3. Backend changes

### 3.1 New dependency

```bash
cd backend
npm install socket.io
npm install --save-dev @types/node  # already present, just confirming no new type pkg needed; socket.io ships its own types
```

### 3.2 New file: `backend/src/realtime/socket.ts`

This is the core module. Responsibilities: create the Socket.IO server attached to the existing HTTP server, authenticate the handshake using the **same JWT** already used by `authMiddleware`, join the right rooms, and expose a small typed `emitToDistrict` / `emitToAdmins` helper that services can call without knowing anything about Socket.IO internals.

```typescript
import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';

interface AuthenticatedSocket extends Socket {
  enumeratorId?: string;
  isAdmin?: boolean;
  districts?: string[];
}

let io: SocketIOServer | null = null;

// Mirrors authMiddleware's decoded-token shape exactly — same JWT, same
// secret, same claims. Do not invent a separate token type for sockets.
interface DecodedToken {
  id: string;
  loginId: string;
  name: string;
  isAdmin: boolean;
}

export function initRealtime(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      // Mirror the exact same origin allowlist as index.ts's cors() config.
      // Do not duplicate-then-diverge — import a shared constant if you can,
      // or keep these two lists next to each other with a comment pointing
      // at one another so they don't drift.
      origin: config.env === 'production'
        ? ['https://mahaatithi.gov.in', 'https://mahathithi.vercel.app', 'http://localhost:5173']
        : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173', 'https://mahathithi.vercel.app'],
      credentials: true,
    },
    // Keep payloads tiny — these are notifications, not data transport.
    // The mobile/admin clients re-fetch or apply a small delta locally;
    // we never push full stakeholder/survey payloads over the socket.
    maxHttpBufferSize: 1e4, // 10KB
  });

  // Auth middleware for the socket handshake — same JWT as REST, verified
  // the same way authMiddleware does it, including re-checking the
  // enumerator is still active (mirrors the "deactivation takes effect
  // immediately" guarantee CLAUDE.md calls out for the REST auth path).
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('UNAUTHORIZED'));

      const decoded = jwt.verify(token, config.jwt.secret) as DecodedToken;

      const enumerator = await prisma.enumerator.findUnique({
        where: { id: decoded.id, isActive: true },
        include: { districts: { include: { district: true } } },
      });

      if (!enumerator) return next(new Error('UNAUTHORIZED'));

      socket.enumeratorId = enumerator.id;
      socket.isAdmin = enumerator.isAdmin;
      socket.districts = enumerator.districts.map((d) => d.district.name.toUpperCase());

      next();
    } catch (err) {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    if (socket.isAdmin) {
      socket.join('admin:global');
    } else {
      (socket.districts || []).forEach((d) => socket.join(`district:${d}`));
    }

    logger.info(`[realtime] connected: enumerator=${socket.enumeratorId} admin=${socket.isAdmin} districts=${(socket.districts || []).join(',')}`);

    // Presence: tell every admin someone came online.
    if (!socket.isAdmin) {
      io!.to('admin:global').emit('enumerator:presence', {
        enumeratorId: socket.enumeratorId,
        status: 'online',
        at: new Date().toISOString(),
      });
    }

    socket.on('disconnect', () => {
      logger.info(`[realtime] disconnected: enumerator=${socket.enumeratorId}`);
      if (!socket.isAdmin) {
        io!.to('admin:global').emit('enumerator:presence', {
          enumeratorId: socket.enumeratorId,
          status: 'offline',
          at: new Date().toISOString(),
        });
      }
    });
  });

  return io;
}

// ---------------------------------------------------------------------------
// Emit helpers — services call these. They are no-ops if realtime hasn't
// been initialized (e.g. in test environments / jest), so existing service
// unit tests do not need to mock Socket.IO.
// ---------------------------------------------------------------------------

export function emitToDistrict(district: string | null | undefined, event: string, payload: unknown): void {
  if (!io || !district) return;
  io.to(`district:${district.toUpperCase()}`).emit(event, payload);
}

export function emitToAdmins(event: string, payload: unknown): void {
  if (!io) return;
  io.to('admin:global').emit(event, payload);
}

// Convenience: most stakeholder-affecting events should reach both the
// owning district's enumerators AND every admin in one call.
export function emitToDistrictAndAdmins(district: string | null | undefined, event: string, payload: unknown): void {
  emitToDistrict(district, event, payload);
  emitToAdmins(event, payload);
}
```

**Why a module-level `io` singleton instead of dependency-injecting it everywhere:** this codebase's service classes (`SurveyService`, `SyncService`, etc.) are instantiated as plain `new X()` inside controller files with no DI container (confirmed in `survey.controller.ts`, `sync.controller.ts`). Retrofitting a DI container is out of scope for this feature. A singleton accessed via import — exactly like `backend/src/config/database.ts`'s exported `prisma` client — matches the existing pattern in this codebase. Keep it consistent with that.

### 3.3 Wire it into `backend/src/index.ts`

`index.ts` currently does `app.listen(...)` directly. Socket.IO needs the raw `http.Server` instance, so this needs `http.createServer(app)` instead of `app.listen()`.

Find this block:

```typescript
async function startServer() {
  try {
    await connectDatabase();
    const server = app.listen(config.port, () => {
      logger.info(`...`);
    });
```

Change to:

```typescript
import { createServer } from 'http';
import { initRealtime } from './realtime/socket';

// ... (unchanged code above)

async function startServer() {
  try {
    await connectDatabase();

    const httpServer = createServer(app);
    initRealtime(httpServer);

    const server = httpServer.listen(config.port, () => {
      logger.info(`...`); // unchanged banner
    });
```

Everything below (`shutdown`, `SIGTERM`/`SIGINT` handlers) stays exactly as-is — `server.close()` already closes the underlying HTTP server Socket.IO is attached to, no extra cleanup needed. Do not add a separate `io.close()` call inside `shutdown` unless you see connections lingering in testing; Socket.IO closes with its HTTP server by default.

**Do not change** the `helmet()` CSP block. Socket.IO's default transport negotiation (polling fallback then upgrade to WebSocket) works fine under the existing `connectSrc` directive as long as the admin panel's deployed origin is already in that list — verify `https://mahathithi.vercel.app` (admin panel's likely host) is present; it already is, per the code shown above. If the admin panel is ever deployed to a different host, that CSP `connectSrc` array needs the new origin added too, in both `index.ts`'s `cors()` config and the realtime module's own CORS config.

### 3.4 Emit from `survey.service.ts` — the primary event

In `backend/src/modules/survey/survey.service.ts`, the `completeSurvey` method already does the `$transaction` that sets `status: 'CLOSED'` + `lockedById`. Emit **after** the transaction commits successfully, not before — never emit a real-time event for a write that might still roll back.

```typescript
import { emitToDistrictAndAdmins } from '../../realtime/socket';

// ... inside completeSurvey, immediately after the existing
// `await prisma.$transaction([...])` call and its surrounding code:

    await prisma.$transaction([
      prisma.survey.update({ /* unchanged */ }),
      prisma.stakeholder.update({ /* unchanged */ }),
      prisma.auditLog.create({ /* unchanged */ }),
    ]);

    logger.info(`Survey completed: ${surveyId}, stakeholder locked by ${enumeratorId}`);

    // REALTIME: notify the district's other enumerators + all admins that
    // this stakeholder is now locked, so devices currently viewing/listing
    // it can react immediately instead of waiting for the next reconnect
    // sync or admin dashboard refetch.
    emitToDistrictAndAdmins(survey.stakeholder.district, 'stakeholder:locked', {
      stakeholderId: survey.stakeholderId,
      lockedById: enumeratorId,
      lockedAt: new Date().toISOString(),
      district: survey.stakeholder.district,
    });

    return {
      status: 'CLOSED',
      message: 'Survey completed successfully. Stakeholder has been closed and locked.',
    };
```

`survey.stakeholder.district` is already available on the `survey` object fetched at the top of `completeSurvey` (it's `include`d there). No extra query needed.

### 3.5 Emit from `admin.routes.ts` — the unlock event

In the `DELETE /enumerators/:id` handler, the existing code already does:

```typescript
await prisma.stakeholder.updateMany({
  where: { lockedById: enumeratorId },
  data: { lockedById: null, lockedAt: null }
});
```

This is a bulk update across potentially many districts, so capture which stakeholders/districts were affected **before** the update (so you know what to broadcast), or — simpler and sufficient for v1 — fetch the distinct districts that were touched right after the update and broadcast per-district. Add:

```typescript
import { emitToDistrictAndAdmins } from '../../realtime/socket';

// Replace the existing updateMany call with this sequence:
const unlockedStakeholders = await prisma.stakeholder.findMany({
  where: { lockedById: enumeratorId },
  select: { id: true, district: true },
});

await prisma.stakeholder.updateMany({
  where: { lockedById: enumeratorId },
  data: { lockedById: null, lockedAt: null }
});

const affectedDistricts = [...new Set(unlockedStakeholders.map(s => s.district).filter(Boolean))];
affectedDistricts.forEach((district) => {
  emitToDistrictAndAdmins(district, 'stakeholder:unlocked', {
    stakeholderIds: unlockedStakeholders.filter(s => s.district === district).map(s => s.id),
    reason: 'enumerator_deactivated',
    district,
  });
});
```

Place this **after** the existing `updateMany`/before the `enumeratorDistricts.deleteMany` call already in that handler — do not reorder anything else in that function (it also deletes sessions and writes an audit log; leave that ordering untouched).

### 3.6 What NOT to touch

- **Do not** modify `sync.service.ts`'s `getChanges` or `processUpload` logic. Real-time is additive; the poll-based reconciliation must keep working exactly as-is for offline-recovery correctness. The "first-to-sync-wins" conflict resolution and `MAX_BATCH_ITEMS` cap are unrelated to this feature.
- **Do not** put any stakeholder PII (contact names, phone numbers, GPS) into socket payloads. Per Section 2/3.4 above, payloads carry only IDs, district name, and timestamps — the receiving client already has (or will fetch via the existing REST endpoints) full stakeholder data. This keeps payloads small and avoids a new data-exposure surface alongside the existing district-scoping model.
- **Do not** add the Redis adapter in this pass (see Section 7).

---

## 4. Mobile changes (React Native)

### 4.1 New dependency

```bash
cd mobile
npm install socket.io-client
```

### 4.2 New file: `mobile/src/services/realtime.ts`

```typescript
import { io, Socket } from 'socket.io-client';
import EncryptedStorage from 'react-native-encrypted-storage';
import Config from 'react-native-config';
import { store } from '../store';
import { stakeholderDao } from '../database';
import { refreshSyncCountsThunk } from '../store/slices/syncThunks';

// Reuse the exact same base resolution logic as services/api.ts — do not
// invent a second source of truth for the server host. api.ts already
// throws at import time if API_BASE_URL is unset in a release build, so by
// the time this module runs that invariant already held.
const API_BASE = Config.API_BASE_URL || (__DEV__ ? 'https://mahathithi-test.up.railway.app/api' : '');
// Socket.IO connects to the server root, not the /api prefix — strip it.
const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, '');

let socket: Socket | null = null;

export async function connectRealtime(): Promise<void> {
  if (socket?.connected) return;

  const token = await EncryptedStorage.getItem('access_token');
  if (!token) return; // not logged in yet — caller retries after login

  socket = io(SOCKET_BASE, {
    auth: { token },
    transports: ['websocket'], // skip long-polling fallback on mobile
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });

  socket.on('connect', () => {
    console.log('[realtime] connected');
  });

  socket.on('connect_error', (err) => {
    // Expected and harmless: token expired (mirrors the existing 401/refresh
    // flow in api.ts) or transient network loss. Do NOT trigger logout or
    // any destructive action here — see the isTransientRefreshError comment
    // in api.ts for exactly why over-reacting to connection errors is
    // dangerous in this app (it previously caused data loss on flaky nets).
    console.log('[realtime] connect_error', err.message);
  });

  socket.on('stakeholder:locked', async (payload: { stakeholderId: string }) => {
    try {
      // Reuses the existing DAO method that getChanges-driven sync already
      // calls — same effect, just arriving immediately instead of on next
      // reconnect poll. Safe to call even if the stakeholder isn't present
      // locally (enumerator outside that survey's view).
      await stakeholderDao.removeLockedStakeholders([payload.stakeholderId]);
    } catch (e) {
      console.warn('[realtime] failed to apply stakeholder:locked locally', e);
    }
  });

  socket.on('stakeholder:unlocked', async (payload: { stakeholderIds: string[] }) => {
    // Unlocked stakeholders need to come back into the local list. The
    // simplest correct action here is to nudge a normal sync, which
    // re-pulls via the existing getChanges/initial-sync path rather than
    // us trying to reconstruct a full stakeholder row from a tiny socket
    // payload (we deliberately do not send full rows over the socket —
    // see backend Section 3.6).
    store.dispatch(refreshSyncCountsThunk() as any);
  });

  socket.on('disconnect', (reason) => {
    console.log('[realtime] disconnected:', reason);
  });
}

export function disconnectRealtime(): void {
  socket?.disconnect();
  socket = null;
}

export async function reauthRealtime(): Promise<void> {
  // Call this after a token refresh (api.ts's attemptRefresh succeeds) so
  // the socket's auth payload isn't left holding a stale/expired token.
  disconnectRealtime();
  await connectRealtime();
}
```

### 4.3 Wire connection lifecycle into `AppNavigator.tsx`

In the same `useEffect` block that already gates on `isAuthenticated` (the one calling `runInitialSync()` and setting up the `NetInfo.addEventListener`), add:

```typescript
import { connectRealtime, disconnectRealtime } from '../services/realtime';

// Inside the existing `useEffect(() => { if (!isAuthenticated) return; ... }, [dispatch, isAuthenticated])`:
useEffect(() => {
  if (!isAuthenticated) return;

  dispatch(runInitialSync() as any);
  connectRealtime(); // ADD THIS — fire-and-forget, errors are logged not thrown

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = NetInfo.addEventListener((state) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (state.isConnected) {
      debounceTimer = setTimeout(() => {
        dispatch(runAutoSync() as any);
      }, 1500);
    }
  });

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    unsubscribe();
    disconnectRealtime(); // ADD THIS
  };
}, [dispatch, isAuthenticated]);
```

This means: socket connects on login, disconnects on logout (when `isAuthenticated` flips false the cleanup runs) — mirrors the existing auth-gated lifecycle pattern already used for the NetInfo listener in this exact block.

### 4.4 Hook into token refresh

In `mobile/src/services/api.ts`, find wherever `attemptRefresh` succeeds and the new `access_token` is written to `EncryptedStorage`. Immediately after that write, call `reauthRealtime()` from the new realtime service (import it there). This keeps the socket's JWT in sync with the REST client's JWT — without this, the socket would silently keep using an old token until it happens to disconnect/reconnect on its own, which could be a long time given `reconnectionDelayMax: 10000` only applies to *failed* reconnect attempts, not to an already-connected-but-stale-token socket (Socket.IO does not re-validate an open connection's auth payload after handshake).

### 4.5 What NOT to touch

- Do not remove or weaken the existing `NetInfo`-driven `runAutoSync()` reconnect trigger. It remains the correctness backbone; the socket is a latency optimization on top of it, not a replacement.
- Do not change `stakeholderDao.removeLockedStakeholders` — reuse it as-is, it already does the right thing (confirmed at `mobile/src/database/index.ts:385`).
- Do not write survey/media data over the socket in either direction. Sync upload remains exclusively through `POST /sync/upload`.

---

## 5. Admin panel changes (React + Vite)

### 5.1 New dependency

```bash
cd admin-panel
npm install socket.io-client
```

### 5.2 New file: `admin-panel/src/realtime.ts`

```typescript
import { io, Socket } from 'socket.io-client';
import { QueryClient } from '@tanstack/react-query';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, '') || window.location.origin;

let socket: Socket | null = null;

// Admin auth is a cookie (admin_session, httpOnly per the C8 FIX comment in
// index.ts's CSP setup) rather than a bearer token read from JS. Socket.IO's
// handshake can ride on the same cookie automatically as long as
// `withCredentials: true` is set — mirrors `withCredentials: true` already
// set on the axios instance in admin-panel/src/api.ts.
export function connectAdminRealtime(queryClient: QueryClient): void {
  if (socket?.connected) return;

  socket = io(SOCKET_BASE, {
    withCredentials: true,
    transports: ['websocket', 'polling'],
  });

  socket.on('stakeholder:locked', () => {
    queryClient.invalidateQueries({ queryKey: ['analytics'] });
  });

  socket.on('stakeholder:unlocked', () => {
    queryClient.invalidateQueries({ queryKey: ['analytics'] });
  });

  socket.on('enumerator:presence', (payload: { enumeratorId: string; status: 'online' | 'offline' }) => {
    queryClient.setQueryData(['enumerator-presence'], (old: Record<string, boolean> = {}) => ({
      ...old,
      [payload.enumeratorId]: payload.status === 'online',
    }));
  });
}

export function disconnectAdminRealtime(): void {
  socket?.disconnect();
  socket = null;
}
```

**Important gap to flag, not silently work around:** the admin handshake here relies on the `admin_session` cookie per `auth.ts`'s `authMiddleware`, which reads `req.cookies.admin_session` as a fallback when there's no `Authorization` header. Socket.IO's Node server reads cookies from the handshake's HTTP upgrade request the same way Express does — but **the realtime auth middleware in `backend/src/realtime/socket.ts` as drafted in Section 3.2 only checks `socket.handshake.auth?.token`, not cookies.** Antigravity must extend that middleware to also accept a cookie-based token for the admin panel's connections, e.g.:

```typescript
// In the io.use(...) handshake middleware, before throwing UNAUTHORIZED:
let token = socket.handshake.auth?.token as string | undefined;
if (!token && socket.handshake.headers.cookie) {
  const cookies = require('cookie').parse(socket.handshake.headers.cookie); // `cookie` is already a transitive dep via cookie-parser
  token = cookies.admin_session;
}
if (!token) return next(new Error('UNAUTHORIZED'));
```

Verify the `cookie` package is resolvable (it's a dependency of `cookie-parser`, already in `backend/package.json`); if `require('cookie')` doesn't resolve cleanly from `node_modules` in this monorepo's hoisting setup, add `cookie` as an explicit direct dependency rather than relying on the transitive one.

### 5.3 Wire into `App.tsx`

Find wherever `QueryClient` is constructed (likely in `main.tsx`, check there first) and wherever the authenticated `user` state becomes non-null in `App.tsx`. Connect on login, disconnect on logout — same pattern as mobile:

```typescript
import { connectAdminRealtime, disconnectAdminRealtime } from './realtime';

useEffect(() => {
  if (!user) {
    disconnectAdminRealtime();
    return;
  }
  connectAdminRealtime(queryClient);
  return () => disconnectAdminRealtime();
}, [user]);
```

Confirm the exact shape of `App.tsx` (its current `user`/auth state management) before writing this — read the file fresh, do not assume the hook shape matches mobile's Redux pattern; admin panel uses React Query + local component state, not Redux (there is no Redux store in `admin-panel/package.json`).

### 5.4 Live indicator UI (optional, Phase 1.5)

Add a small "🟢 N enumerators online" badge to `Layout.tsx`'s sidebar footer area (near the existing user info block), reading from `queryClient.getQueryData(['enumerator-presence'])`. Not required for correctness — flag as a nice-to-have, implement only after 3.x/4.x/5.1–5.3 are verified working end-to-end.

---

## 6. Verification checklist (do not mark this done until all pass)

1. Two mobile devices/emulators logged in as enumerators assigned to the **same** district. Device A completes a survey (full flow: photos + video + complete()). Confirm Device B's stakeholder list removes/greys that stakeholder within a few seconds, **without** Device B going through a network reconnect cycle.
2. Repeat with Device B logged in as an enumerator in a **different, non-overlapping** district. Confirm Device B receives **nothing** for Device A's completion — this is the access-control regression test, not optional.
3. Admin panel open in a browser tab during Device A's completion. Confirm the dashboard's analytics numbers update without a manual page refresh.
4. Kill the mobile device's WiFi mid-session, confirm `connect_error` is logged but the app does not log the user out or wipe local data (cross-check against the existing `isTransientRefreshError` safety logic in `api.ts` — the socket layer must fail in the same "stay calm" direction).
5. Admin deactivates an enumerator who has 1+ locked stakeholders. Confirm another enumerator in that district sees the stakeholder become available again in real time.
6. Restart the backend process while a mobile client is connected. Confirm the mobile client's Socket.IO client auto-reconnects within `reconnectionDelayMax` and resumes receiving events, without requiring an app restart.
7. Confirm `npm run build` (admin-panel) and `npm run lint` (backend, mobile) all pass with the new files — `socket.ts`, `realtime.ts` (mobile), `realtime.ts` (admin) need to satisfy each package's existing ESLint/TS config, not introduce new `any`-laden code where the existing codebase has typed equivalents nearby.

---

## 7. Explicit non-goals / future work (do not implement now, just leave the door open)

- **Multi-instance scaling (Redis adapter):** if Railway is ever configured with >1 replica of the backend, swap `new SocketIOServer(...)` in `socket.ts` for one configured with `@socket.io/redis-adapter`, backed by a TCP Redis connection (`ioredis`, pointed at a Redis URL — Upstash offers this alongside their REST API, but it's a different connection string/credential than `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` already in `config/index.ts`). Add a new `requireEnv` entry for that connection string when this becomes necessary, following the exact fail-fast pattern already used for `DATABASE_URL`/`JWT_SECRET` in `config/index.ts`.
- **Survey-level live collaboration** (e.g. showing "Enumerator X is currently filling this survey") is out of scope — the current data model has no concept of an in-progress (non-locked) survey being actively edited by someone else; only completion is observable. Don't build presence-per-survey without that data model support.
- **Push notifications when the app is backgrounded/killed** (e.g. via Firebase Cloud Messaging) are a separate feature from in-app Socket.IO real-time and are not part of this plan. Socket.IO connections do not survive the OS killing a backgrounded RN app; that's expected and fine for this feature's scope (this is a near-real-time *list/dashboard freshness* feature, not a notification system).