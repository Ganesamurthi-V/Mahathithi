# MahaAtithi — Security Audit Follow-Up Report

**Source:** `Mahathithi-feature-sqlite` branch  
**Based on:** Original `Security_audit_report.md`  
**Scope:** Manual line-by-line verification of every finding from the original report against the current codebase, plus new issues discovered during this review.

**Status legend:**
- ✅ **FIXED** — completely resolved, verified in code
- ⚠️ **PARTIAL** — attempted but incomplete or introduces a new sub-problem
- ❌ **NOT FIXED** — no change from the original finding
- 🆕 **NEW** — issue not present in the original report, introduced or discovered in this branch

---

## Table of Contents

1. [Critical Issues — Status](#critical-issues--status)
2. [High Issues — Status](#high-issues--status)
3. [Medium Issues — Status](#medium-issues--status)
4. [Low / Hygiene Issues — Status](#low--hygiene-issues--status)
5. [New Issues Found in This Branch](#new-issues-found-in-this-branch)
6. [Summary Table](#summary-table)

---

## Critical Issues — Status

---

### C1. Hardcoded fallback JWT secret ✅ FIXED

**Original problem:** `JWT_SECRET` fell back to a hardcoded string (`'dev-secret-change-in-production'`) if the env var was missing at startup.

**Verified fix in `backend/src/config/index.ts`:**

```ts
function requireEnv(name: string, minLength = 1): string {
  const value = process.env[name];
  if (!value || value.length < minLength) {
    throw new Error(
      `[STARTUP] Missing or invalid required environment variable: ${name}` +
      (minLength > 1 ? ` (must be at least ${minLength} characters)` : '')
    );
  }
  return value;
}

jwt: {
  secret: requireEnv('JWT_SECRET', 32),
  ...
},
database: {
  url: requireEnv('DATABASE_URL'),
},
```

The server now fails immediately at startup if `JWT_SECRET` is missing or shorter than 32 characters. `DATABASE_URL` is also validated. **Fully resolved.**

> **Remaining note:** `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` still use `|| ''` fallbacks. These are not runtime-critical in the same way (the app will boot without them), but a missing AWS key will cause silent upload failures in production. Consider adding `requireEnv` for these too if S3 upload is always required.

---

### C2. Survey create/update/read has no district or ownership check (IDOR) ✅ FIXED

**Original problem:** `createOrUpdate` and `getByStakeholderId` in `survey.service.ts` had no district check — any enumerator could read or write surveys for any stakeholder.

**Verified fix in `backend/src/modules/survey/survey.service.ts`:**

```ts
import { assertStakeholderAccess } from '../../utils/access-control';

async createOrUpdate(data: CreateSurveyData, enumeratorDistricts: string[], isAdmin: boolean) {
  const stakeholder = await prisma.stakeholder.findUnique({ where: { id: data.stakeholderId } });
  if (!stakeholder) throw new NotFoundError('Stakeholder');
  assertStakeholderAccess(stakeholder, enumeratorDistricts, isAdmin); // ✅ district check
  ...
}

async getByStakeholderId(stakeholderId: string, enumeratorDistricts: string[], isAdmin: boolean) {
  const stakeholder = await prisma.stakeholder.findUnique({ where: { id: stakeholderId } });
  if (!stakeholder) throw new NotFoundError('Stakeholder');
  assertStakeholderAccess(stakeholder, enumeratorDistricts, isAdmin); // ✅ district check
  ...
}
```

The shared `assertStakeholderAccess` utility (`backend/src/utils/access-control.ts`) is properly implemented and used here. Controller passes `req.enumerator!.districts` and `req.enumerator!.isAdmin` through. **Fully resolved.**

---

### C3. Media endpoints have zero ownership/district checks ✅ FIXED

**Original problem:** `getBySurvey`, `upload`, and `delete` in `media.service.ts` had no ownership or district enforcement — any enumerator could read, upload, or delete any survey's media.

**Verified fix in `backend/src/modules/media/media.service.ts` and `media.controller.ts`:**

- `upload`: checks `survey.enumeratorId !== data.enumeratorId` for existing surveys, blocks access for non-owners.
- `getBySurvey`: performs district check via `callerDistricts.some(d => d.toUpperCase() === survey.stakeholder?.district?.toUpperCase())`.
- `delete`: checks `media.survey.enumeratorId !== enumeratorId` before proceeding.

All three paths now require and thread through `callerDistricts` and `isAdmin`. **Fully resolved.**

---

### C4. Media upload auto-creates surveys for arbitrary stakeholders (lock bypass) ✅ FIXED

**Original problem:** `POST /media/upload` with `surveyId = "draft_<any-stakeholder-id>"` silently created a survey for any stakeholder, bypassing district checks and the lock model.

**Verified fix in `backend/src/modules/media/media.service.ts`:**

```ts
// C4 FIX: before auto-creating a draft survey, verify the caller
// is actually assigned to this stakeholder's district and the
// stakeholder is not already locked by someone else.
const stakeholder = await prisma.stakeholder.findUnique({ where: { id: stakeholderId } });
if (!stakeholder) throw new NotFoundError('Stakeholder');
assertStakeholderAccess(stakeholder, callerDistricts, isAdmin);
if (stakeholder.lockedById && stakeholder.lockedById !== data.enumeratorId) {
  throw new ConflictError('This stakeholder has been completed by another enumerator');
}
const newSurvey = await prisma.survey.create({ ... });
```

The draft creation path now goes through the same district and lock checks as the regular survey creation path. **Fully resolved.**

---

### C5. Phone validation endpoints have no ownership/district checks ⚠️ PARTIAL FIX

**Original problem:** `getByStakeholder` had no district check. `update` had no enum validation and no ownership check.

**What was fixed (`backend/src/modules/phone-validation/phone-validation.controller.ts`):**

- `getByStakeholder`: now calls `assertStakeholderAccess` before returning records. ✅
- `update`: now validates `status` against `ALLOWED_STATUSES` and checks `existing.enumeratorId !== req.enumerator!.id`. ✅

**What is still broken — `create` has no district check:**

```ts
async create(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { stakeholderId, phoneNumber, status, method, remarks } = req.body;
    // ❌ NO assertStakeholderAccess call here
    // Any enumerator can create a phone validation record for any stakeholder
    const validation = await prisma.phoneValidation.create({
      data: { stakeholderId, enumeratorId: req.enumerator!.id, ... }
    });
  }
}
```

An enumerator can call `POST /phone-validations` with any `stakeholderId` — including stakeholders in other districts — and the server will create the record without checking district assignment. This is the same IDOR class as the original C5 finding; it just survived the patch.

**Fix required:**

```ts
async create(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { stakeholderId, phoneNumber, status, method, remarks } = req.body;

    if (!stakeholderId || !phoneNumber) {
      throw new ValidationError('Stakeholder ID and phone number are required');
    }
    if (!ALLOWED_STATUSES.includes(status)) {
      throw new ValidationError('Invalid verification status');
    }

    // ADD THIS: district check before writing
    const stakeholder = await prisma.stakeholder.findUnique({ where: { id: stakeholderId } });
    if (!stakeholder) throw new NotFoundError('Stakeholder');
    assertStakeholderAccess(stakeholder, req.enumerator!.districts, req.enumerator!.isAdmin);

    const validation = await prisma.phoneValidation.create({ ... });
    ...
  }
}
```

---

### C6. Stakeholder `district`/`state` editable through PATCH (privilege escalation) ✅ FIXED

**Original problem:** The `allowedFields` list in `stakeholder.service.ts` included `district` and `state`, allowing any enumerator to reassign a stakeholder to their own district.

**Verified fix in `backend/src/modules/stakeholder/stakeholder.service.ts`:**

```ts
// C6 FIX: district & state intentionally removed from this list.
const allowedFields = [
  'companyNameStandardized', 'addressLine1', 'addressLine2',
  'city', 'taluka', 'village', 'pinCode', 'category',
  // district & state intentionally removed — admin-only operation
];
```

`district` and `state` are removed from the PATCH allowed list. **Fully resolved.**

> **Note:** The audit report also recommended an admin-only `PATCH /admin/stakeholders/:id/relocate` endpoint for legitimate district corrections. This endpoint was **not added** to `admin.routes.ts` (confirmed: `grep "relocate" admin.routes.ts` returns 0 results). The omission is acceptable for now since the dangerous path is blocked, but admins currently have no UI/API path to correct a mis-tagged district without directly touching the database. This should be tracked as a follow-up task.

---

### C7. Database & cache exposed with hardcoded default password ✅ FIXED

**Original problem:** `docker-compose.yml` had `POSTGRES_PASSWORD` with a real-looking hardcoded fallback password, and both Postgres and Redis ports were published to the host (5432/6379).

**Verified fix in `docker-compose.yml`:**

```yaml
postgres:
  environment:
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env}
  expose:         # ✅ expose not ports — not reachable from outside
    - "5432"

redis:
  command: ["redis-server", "--requirepass", "${REDIS_PASSWORD:?REDIS_PASSWORD must be set in .env}"]
  expose:
    - "6379"
  healthcheck:
    test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
```

Docker now errors at startup if either password variable is unset. Ports are exposed only to the internal compose network. Redis requires a password. **Fully resolved.**

---

### C8. Admin panel stores JWT in `localStorage` ❌ NOT FIXED

**Original problem:** The admin panel (highest-privilege client) stores the access token and refresh token in `localStorage`, which is readable by any JavaScript on the page — one XSS bug equals full admin account takeover.

**Current state in `admin-panel/src/api.ts`:**

```ts
// ❌ Still using localStorage
const token = localStorage.getItem('admin_token');
```

**Current state in `admin-panel/src/App.tsx`:**

```ts
// ❌ Still using localStorage — no change from the original
localStorage.setItem('admin_token', tokens.accessToken);
localStorage.setItem('admin_refresh', tokens.refreshToken);
```

The audit report offered two fixes in priority order:

1. **Minimum viable — add a Content Security Policy** via Helmet's `contentSecurityPolicy` directive when serving the admin panel. The backend's `app.use(helmet(...))` call does **not** include a `contentSecurityPolicy` configuration — only `crossOriginResourcePolicy` is set. Without a strict CSP, an XSS via any dependency can read `localStorage` freely.

2. **Real fix — move to httpOnly, Secure, SameSite=Strict cookies.** Not implemented.

Neither of the two recommended mitigations has been applied. This remains the most accessible privilege-escalation path for an external attacker who can achieve XSS on the admin panel.

**Fix (minimum viable — add CSP to the backend's Helmet config):**

```ts
// backend/src/index.ts
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", 'https://mahaatithi.gov.in'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));
```

**Fix (proper long-term — httpOnly cookie session):**

```ts
// backend/src/modules/auth/auth.controller.ts — on login success:
res.cookie('admin_session', tokens.accessToken, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  maxAge: 15 * 60 * 1000, // 15 minutes
});
res.json({ success: true, data: { enumerator } }); // don't send token in body
```

```ts
// admin-panel/src/api.ts — remove all localStorage usage:
const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // send cookie automatically
  headers: { 'Content-Type': 'application/json' },
});
// Remove the request interceptor that reads localStorage
```

---

## High Issues — Status

---

### H1. Sync upload endpoint has no district check ✅ FIXED

**Original problem:** `sync.service.ts` `processUpload` had no district check on the `surveys` array — any enumerator could sync data for out-of-district stakeholders.

**Verified fix in `backend/src/modules/sync/sync.service.ts`:**

```ts
// H1 FIX: enforce district scope — same rule as every other endpoint
if (!isAdmin) {
  const inDistrict = districts.some(
    (d) => d.toUpperCase() === stakeholder.district?.toUpperCase()
  );
  if (!inDistrict) {
    results.surveys.failed++;
    results.surveys.errors.push(`Stakeholder ${surveyData.stakeholderId}: outside assigned districts`);
    continue;
  }
}
```

`processUpload` signature now accepts `districts: string[]` and `isAdmin: boolean`, passed from the controller. M2 (batch size cap) is also fixed here. **Fully resolved.**

---

### H2. Refresh tokens stored in plaintext ✅ FIXED

**Original problem:** Refresh tokens were stored raw in the `Session` table — a DB leak handed an attacker fully valid 7-day credentials.

**Verified fix in `backend/src/modules/auth/auth.service.ts`:**

```ts
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// On login/refresh, store the hash:
await prisma.session.create({
  data: {
    ...
    refreshToken: hashToken(tokens.refreshToken), // ✅ hash stored, not raw token
    ...
  },
});

// On refresh, look up by hash:
const session = await prisma.session.findUnique({
  where: { refreshToken: hashToken(refreshToken) },
});
```

SHA-256 hash is stored server-side; the raw token still sent to clients. **Fully resolved.**

---

### H3. `PATCH /stakeholders/:id/status` validates against the wrong enum ✅ FIXED

**Original problem:** The controller validated against `['PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED']` but the Prisma schema defines `StakeholderStatus` as `OPEN | CLOSED`. Every valid input caused a Prisma cast error — the endpoint was permanently non-functional.

**Verified fix in `backend/src/modules/stakeholder/stakeholder.controller.ts`:**

```ts
// H3 FIX: validate against the real Prisma enum — StakeholderStatus is OPEN/CLOSED
const validStatuses = ['OPEN', 'CLOSED'];
if (!status || !validStatuses.includes(status)) {
  throw new ValidationError(`Invalid status value. Must be one of: ${validStatuses.join(', ')}`);
}
```

The endpoint now validates against the correct values and will function. **Fully resolved.**

> **Note on access control:** The `updateStatus` endpoint is behind `districtGuard` (non-admin enumerators can call it for stakeholders in their district). Since `CLOSED` status is the same state set by `completeSurvey`, this creates a path for an enumerator to manually force a stakeholder to `CLOSED` without meeting any of the survey completion requirements (photos, video, GPS, etc.). Consider whether this endpoint should be admin-only, or whether it should call through `completeSurvey`'s validation logic.

---

### H4. Uploaded filenames — MIME type sniffing from declared type only ✅ FIXED

**Original problem:** `file.mimetype` was the client-declared `Content-Type` header — trivially spoofable. Any file type could be uploaded labeled as an image.

**Verified fix in `backend/src/modules/media/media.routes.ts`:**

```ts
// Magic byte signatures implemented inline — no external dependency needed:
function detectMimeFromBytes(buffer: Buffer): string | null {
  // JPEG, PNG, HEIC/HEIF, MP4, MOV, 3GPP all detected from magic bytes
  ...
}

function verifyMagicBytes(req, res, next) {
  const detected = detectMimeFromBytes(req.file.buffer);
  if (!detected || !ALLOWED_MIME_TYPES.has(detected)) {
    return res.status(400).json({ ... 'File content does not match an allowed media type' ... });
  }
  req.file.mimetype = detected; // ✅ overwrites client-declared type with real detected type
  next();
}

router.post('/upload', uploadLimiter, upload.single('file'), verifyMagicBytes, controller.upload);
```

Magic byte detection is implemented as an inline middleware rather than using `file-type` npm package (avoiding a dependency), covering JPEG, PNG, HEIC, MP4, MOV, and 3GPP. The detected MIME type overwrites the client-declared type before reaching the service layer. **Fully resolved.**

---

### H5. Uploaded filenames used unsanitized in S3 key ✅ FIXED

**Original problem:** `file.originalname` (client-supplied) was used directly in the S3 key, allowing path traversal or unicode injection.

**Verified fix in `backend/src/modules/media/media.service.ts`:**

```ts
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

// H5 FIX: generate a UUID-based filename for the S3 key
const ext = path.extname(data.fileName).toLowerCase().replace(/[^a-z0-9.]/g, '');
const safeStorageName = `${uuidv4()}${ext}`;
const s3Key = generateS3Key(data.type === 'PHOTO' ? 'photo' : 'video', resolvedSurveyId, safeStorageName);

// Original client name kept only in DB as display metadata:
fileName: data.fileName,
```

S3 keys now use a server-generated UUID. Client-supplied filename is stored only as display metadata. **Fully resolved.**

---

### H6. `facilities.controller.ts` bypasses centralized error handler ✅ FIXED

**Original problem:** Every other module routed errors through `errorHandler`, but `facilities.controller.ts` always called `res.status(500).json({ message: error.message })`, leaking Prisma internals regardless of environment.

**Verified fix in `backend/src/modules/facilities/facilities.controller.ts`:**

```ts
export const syncOfflineFacilities = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    ...
    res.json({ status: 'success', data: facilities });
  } catch (error) {
    next(error); // ✅ routes to shared errorHandler
  }
};
```

**Fully resolved.**

---

### H7. No account lockout / brute-force protection beyond IP rate limiting ⚠️ PARTIAL FIX

**Original problem:** `loginLimiter` was keyed by IP only. A distributed attacker or shared-NAT scenario could brute-force a specific account's password with no per-account throttle.

**What was fixed in `backend/src/modules/auth/auth.service.ts`:**

```ts
// Per-account in-memory lockout map
const loginFailures = new Map<string, LockoutEntry>();

// Locks after MAX_FAILED_ATTEMPTS = 5 consecutive failures for 15 minutes
function checkAndRecordFailure(loginId: string): void { ... }
function checkLocked(loginId: string): void { ... }
function clearFailures(loginId: string): void { ... }
```

This is a real improvement over the IP-only approach. However, the implementation uses an **in-memory `Map`** instead of Redis (which is already in the stack and was the recommended implementation in the original report).

**Why this matters:**

1. **Multi-instance deployments:** If the backend ever runs with more than one process (horizontal scaling, rolling deploys, Railway auto-scale), each instance has its own independent `Map`. An attacker can route 4 failed attempts to instance A and 4 to instance B, never triggering a lockout on either.

2. **Restarts clear the lockout:** Deploying a new version resets all lockout state instantly. An attacker watching deploy cycles can time attacks to coincide with restarts.

3. **Memory growth:** The `Map` is never pruned. Every `loginId` that has ever failed leaves an entry in memory forever (unless it gets locked and never cleared). Under a credential-stuffing attack with a large wordlist of login IDs, this could become a memory concern.

The original report explicitly recommended using Redis for exactly these reasons. Redis is already running (`config.redis.url`), so the fix is available.

**Fix — use Redis instead of in-memory Map:**

```ts
// backend/src/modules/auth/auth.service.ts
import { redisClient } from '../../config/redis'; // create a thin wrapper if not present

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60;

async function checkLocked(loginId: string): Promise<void> {
  const locked = await redisClient.get(`login_lock:${loginId}`);
  if (locked) {
    throw new UnauthorizedError('Account temporarily locked. Try again in 15 minutes.');
  }
}

async function recordFailure(loginId: string): Promise<void> {
  const key = `login_attempts:${loginId}`;
  const attempts = await redisClient.incr(key);
  await redisClient.expire(key, LOCKOUT_SECONDS);
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    await redisClient.set(`login_lock:${loginId}`, '1', { EX: LOCKOUT_SECONDS });
  }
}

async function clearFailures(loginId: string): Promise<void> {
  await redisClient.del(`login_attempts:${loginId}`);
  await redisClient.del(`login_lock:${loginId}`);
}
```

---

## Medium Issues — Status

---

### M1. `express.json({ limit: '50mb' })` applied globally ✅ FIXED

**Verified fix in `backend/src/index.ts`:**

```ts
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
```

And in `sync.routes.ts` the 25MB limit is scoped to only the sync upload route. **Fully resolved.**

---

### M2. No item-count cap on sync upload payload arrays ✅ FIXED

**Verified fix in `backend/src/modules/sync/sync.service.ts`:**

```ts
const MAX_BATCH_ITEMS = 200;

if ((payload.surveys?.length || 0) > MAX_BATCH_ITEMS || (payload.phoneValidations?.length || 0) > MAX_BATCH_ITEMS) {
  throw new ValidationError(`Batch too large. Maximum ${MAX_BATCH_ITEMS} items per array per request.`);
}
```

**Fully resolved.**

---

### M3. CORS allowlist includes non-HTTPS localhost in production ✅ FIXED

**Verified fix in `backend/src/index.ts`:**

```ts
app.use(cors({
  origin: config.env === 'production'
    ? ['https://mahaatithi.gov.in']    // ✅ only production domain
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'],
  credentials: true,
}));
```

`http://localhost:5173` no longer appears in the production allowlist. **Fully resolved.**

---

### M4. `dashboard.service.ts` leaks global sync-queue counts to non-admins ✅ FIXED

**Verified fix in `backend/src/modules/dashboard/dashboard.service.ts`:**

```ts
const syncFilter = isAdmin
  ? {}
  : { enumeratorId }; // ✅ scope to this enumerator's own queue items

const [pendingSync, failedSync] = await Promise.all([
  prisma.syncQueue.count({ where: { ...syncFilter, status: 'PENDING' } }),
  prisma.syncQueue.count({ where: { ...syncFilter, status: 'FAILED' } }),
]);
```

Non-admin enumerators now see only their own sync queue counts. **Fully resolved.**

> **Note:** The `SyncQueue` schema currently has no `enumeratorId` column (confirmed in `prisma/schema.prisma`). The `syncFilter = { enumeratorId }` filter will silently return 0 for all non-admin users because no rows will ever match a field that doesn't exist. This is a runtime correctness bug — not a security regression, but the dashboard sync stats will always show 0/0 for non-admins until the column is added. See New Issue N1 below.

---

### M5. No centralized request validation ❌ NOT FIXED

**Original problem:** Validation is hand-rolled per route, inconsistent, and doesn't enforce length limits on free-text fields.

**Current state:** No Zod schemas have been added. No validation schema files (`*.schema.ts`) exist in the codebase. The only length-related validation added is the password strength check in `admin.routes.ts` (covered under L1). Free-text fields like `notes`, `remarks`, `contactPerson`, `addressLine1`, `website`, `email`, and `gstNumber` across survey, phone-validation, and stakeholder routes still accept strings of arbitrary length.

**What this means in practice:** A malicious enumerator can POST 10MB of text into a `notes` field (the 1MB body limit from M1 constrains the total request, but a 900KB notes field is still valid), causing oversized rows in Postgres, inflated storage costs, and potential application-layer issues in places that process or display the field.

**Fix — add Zod schemas per route (example for survey):**

```ts
// backend/src/modules/survey/survey.schema.ts
import { z } from 'zod';

export const createOrUpdateSurveySchema = z.object({
  stakeholderId: z.string().uuid(),
  contactPerson: z.string().max(200).optional(),
  designation: z.string().max(200).optional(),
  mobileNumber: z.string().max(20).optional(),
  email: z.string().email().max(200).optional(),
  website: z.string().url().max(500).optional(),
  notes: z.string().max(2000).optional(),
  remarks: z.string().max(2000).optional(),
  gstNumber: z.string().max(15).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});
```

```ts
// survey.controller.ts
import { createOrUpdateSurveySchema } from './survey.schema';

async createOrUpdate(req, res, next) {
  try {
    const parsed = createOrUpdateSurveySchema.parse(req.body); // throws ZodError → 400
    ...
  }
}
```

Add a `ZodError` branch to `error-handler.ts` to return clean 400 responses with field-level detail.

---

### M6. HTTPS/HSTS enforcement not verified ✅ FIXED

**Verified fix in `backend/src/index.ts`:**

```ts
if (config.env === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}
```

HTTP requests are redirected to HTTPS in production. Helmet's default HSTS header is active. **Fully resolved.**

---

### M7. Hardcoded backend URL in mobile app ⚠️ PARTIAL FIX

**Original problem:** `API_BASE` was hardcoded to the Railway test URL with no build-time configuration.

**What was changed in `mobile/src/services/api.ts`:**

```ts
const API_BASE = (globalThis as any).__ENV__?.API_BASE_URL
  || (__DEV__ ? 'https://mahathithi-test.up.railway.app/api' : '');

if (!API_BASE) {
  throw new Error('[CONFIG] API_BASE_URL is not set. Set it via .env.production before building a release.');
}
```

This is better — production builds will crash at initialization if `API_BASE_URL` is not injected, which prevents accidentally shipping a production build pointing at the test server. However:

1. **`react-native-config` is not installed.** The mobile `package.json` has no `react-native-config` or `react-native-dotenv` dependency. The `(globalThis as any).__ENV__` pattern depends on a custom Metro bundler plugin or build-time injection mechanism that is not present in the repo. Without the actual build setup, `__ENV__` will always be `undefined`, meaning every non-`__DEV__` build will throw the config error.

2. **The fallback still points at the test Railway URL.** In `__DEV__` mode (all local development and debug builds), the URL is still hardcoded to `https://mahathithi-test.up.railway.app/api`. This is acceptable for development but means dev builds always hit the live test server, not a local backend.

**Fix — install and wire up `react-native-config`:**

```bash
npm install --save react-native-config
cd ios && pod install
```

```ts
// mobile/src/services/api.ts
import Config from 'react-native-config';

const API_BASE = Config.API_BASE_URL;
if (!API_BASE) throw new Error('[CONFIG] API_BASE_URL not set');
```

```
# mobile/.env.development
API_BASE_URL=http://localhost:3000/api

# mobile/.env.production
API_BASE_URL=https://api.mahaatithi.gov.in/api
```

---

## Low / Hygiene Issues — Status

---

### L1. No password strength policy ✅ FIXED

**Verified fix in `backend/src/modules/admin/admin.routes.ts`:**

```ts
// L1 FIX: enforce minimum password strength before hashing.
function validatePassword(password: string): void {
  if (password.length < 10) { ... }
  if (!/[A-Z]/.test(password)) { ... }
  if (!/[a-z]/.test(password)) { ... }
  if (!/[0-9]/.test(password)) { ... }
  if (!/[^A-Za-z0-9]/.test(password)) { ... }
}
```

Minimum 10 characters, must contain uppercase, lowercase, digit, and special character. **Fully resolved.**

---

### L2. No mobile TLS certificate pinning ❌ NOT FIXED

No TLS pinning library (`react-native-ssl-pinning` or platform-native pinning) has been added to `mobile/package.json`. This is a low-priority hygiene item and its absence doesn't block launch, but is especially relevant for a field app handling PII on untrusted mobile networks.

---

### L3. No automated dependency vulnerability scanning ⚠️ PARTIAL FIX

**What was added:** An `"audit": "npm audit --production"` script in `backend/package.json`.

**What is still missing:**
- No equivalent `audit` script in `admin-panel/package.json` or `mobile/package.json`.
- No CI configuration (`.github/workflows`, `railway.toml` job step, etc.) runs `npm audit` automatically on push. The script exists but is not wired into any automated pipeline.
- No Dependabot or Renovate configuration in the repo root.

**Fix:**
1. Add `"audit": "npm audit --production"` to `admin-panel/package.json` and `mobile/package.json`.
2. Add a GitHub Actions workflow (or equivalent) that runs `npm audit` in all three package directories on every PR.
3. Optionally add `.github/dependabot.yml` for automated dependency update PRs.

---

### L4. Log PII redaction policy ❌ NOT FIXED

`backend/src/utils/logger.ts` uses Winston with no redaction configuration. The `logger.info(...)` calls throughout the codebase include `loginIds`, `stakeholderIds`, `phoneNumbers`, and district names in log messages. If logs are ever shipped to a third-party sink (Datadog, Logtail, Railway log drain), this PII travels unredacted.

**Fix — add Winston redaction when connecting an external transport:**

```ts
// backend/src/utils/logger.ts
import { createLogger, format, transports } from 'winston';

const redactFields = ['phoneNumber', 'mobileNumber', 'email', 'password', 'passwordHash'];

const redactSensitive = format((info) => {
  redactFields.forEach(field => {
    if (info[field]) info[field] = '[REDACTED]';
  });
  return info;
})();

export const logger = createLogger({
  format: format.combine(redactSensitive, format.timestamp(), format.printf(...)),
  transports: [...],
});
```

---

### L5. Expired/invalidated `Session` rows never purged ✅ FIXED

**Verified fix:** `backend/src/scripts/cleanupSessions.ts` was added. It deletes sessions where `expiresAt < now()` and sessions where `isValid = false` (with a 24-hour grace period). The script includes instructions for running as a Railway Cron Service. **Fully resolved.**

---

### L6. Media `delete` is non-atomic (S3 + DB as separate steps) ⚠️ PARTIAL FIX

**Original problem:** `deleteFromS3` and `prisma.media.delete` were two separate steps with no atomicity. If S3 succeeded but DB failed, you'd have a dangling DB reference to a deleted file.

**What was implemented in `media.service.ts`:**

```ts
// Soft-delete in DB first (tombstone), then delete from S3
await prisma.media.update({
  where: { id: mediaId },
  data: { deletedAt: new Date() },  // soft-delete
});

try {
  await deleteFromS3(media.filePath);
  await prisma.media.delete({ where: { id: mediaId } }); // hard-delete on success
} catch (s3Error) {
  // Tombstone left in DB for background retry
  throw s3Error;
}
```

The approach is logically correct — soft-delete first prevents referencing a deleted file. **However, the `deletedAt` field does not exist in the Prisma schema (`prisma/schema.prisma`).**

The `Media` model has no `deletedAt` column. The `prisma.media.update({ data: { deletedAt: new Date() } })` call will throw a Prisma validation error at runtime: `Unknown arg 'deletedAt' in data.deletedAt for type MediaUpdateInput`. The delete endpoint is currently broken — it will 500 on the soft-delete step for every request.

Additionally, `getBySurvey` does not filter on `deletedAt IS NULL`, so if the schema is fixed without also updating the query, soft-deleted media will continue to appear in survey listings.

**Fix — add the field to the schema and update the query:**

```prisma
// prisma/schema.prisma — Media model
model Media {
  ...
  deletedAt       DateTime?     @map("deleted_at")  // ADD THIS
  ...
}
```

```ts
// media.service.ts — getBySurvey
const media = await prisma.media.findMany({
  where: {
    surveyId,
    deletedAt: null,  // ADD THIS — exclude soft-deleted items
  },
  orderBy: { capturedAt: 'asc' },
});
```

Run `npx prisma migrate dev --name add-media-deleted-at` after updating the schema.

---

## New Issues Found in This Branch

---

### N1. `SyncQueue.enumeratorId` column doesn't exist — M4 fix silently breaks dashboard 🆕 NEW

**Severity:** 🟡 MEDIUM (correctness bug, not a security issue)

**File:** `backend/prisma/schema.prisma`, `backend/src/modules/dashboard/dashboard.service.ts`

**Problem:**

The M4 fix added `{ enumeratorId }` to the sync queue filter for non-admin users:

```ts
const syncFilter = isAdmin ? {} : { enumeratorId };
prisma.syncQueue.count({ where: { ...syncFilter, status: 'PENDING' } })
```

The `SyncQueue` model in `prisma/schema.prisma` has no `enumeratorId` field:

```prisma
model SyncQueue {
  id           String     @id @default(uuid())
  entityType   String
  entityId     String
  action       SyncAction
  payload      Json?
  status       SyncStatus @default(PENDING)
  retryCount   Int        @default(0)
  // ... no enumeratorId field
}
```

At runtime, Prisma will throw `Unknown arg 'enumeratorId' in where.enumeratorId`. The dashboard `GET /dashboard/stats` endpoint will 500 for every non-admin user.

**Fix — add the column to the schema and migrate:**

```prisma
// prisma/schema.prisma
model SyncQueue {
  id           String      @id @default(uuid())
  enumeratorId String?     @map("enumerator_id")  // ADD THIS
  entityType   String      @map("entity_type")
  entityId     String      @map("entity_id")
  // ...
  enumerator   Enumerator? @relation(fields: [enumeratorId], references: [id])

  @@index([enumeratorId])
  @@index([status])
  @@map("sync_queue")
}
```

And populate `enumeratorId` wherever `SyncQueue` entries are created in `sync.service.ts`.

---

### N2. `media.delete` is broken at runtime — L6 soft-delete references a non-existent schema field 🆕 NEW

**Severity:** 🔴 CRITICAL (the entire media delete endpoint throws a 500 on every call)

Already described in detail under [L6](#l6-media-delete-is-non-atomic-s3--db-as-separate-steps-️-partial-fix). Promoted here as a standalone new issue because it is a **regression** — the delete endpoint worked (with the original atomicity flaw) before this branch; now it is completely non-functional.

**Immediate fix:** Add `deletedAt DateTime? @map("deleted_at")` to the `Media` model in `prisma/schema.prisma` and run a migration. Also update `getBySurvey` to filter `deletedAt: null`.

---

### N3. `H3` `updateStatus` endpoint is accessible by any enumerator — no admin guard 🆕 NEW

**Severity:** 🟠 HIGH

**File:** `backend/src/modules/stakeholder/stakeholder.routes.ts`

**Problem:**

```ts
router.patch('/:id/status', districtGuard, controller.updateStatus);
```

`updateStatus` now accepts `OPEN` or `CLOSED` (H3 fix). Setting a stakeholder to `CLOSED` is the same outcome as completing a survey — it locks the record. However, this route only requires `districtGuard` (any enumerator in the right district), not `adminMiddleware`. This means any enumerator can:

1. Force a stakeholder to `CLOSED` without completing the survey requirements (no photos, no GPS, no phone verification needed).
2. Force a stakeholder back to `OPEN` — effectively unlocking a record that another enumerator legitimately completed, reopening it for tampering.

**Fix — restrict to admin only:**

```ts
// stakeholder.routes.ts
import { adminMiddleware } from '../../middleware/admin'; // or check req.enumerator!.isAdmin

router.patch('/:id/status', adminMiddleware, controller.updateStatus); // admin-only
```

If there is a legitimate reason for non-admin enumerators to change status, remove the `CLOSED` option from their allowed values and limit them to `OPEN → IN_PROGRESS` type transitions only (which would require revisiting the status enum).

---

### N4. `phone-validation/create` has no district check — C5 patch is incomplete 🆕 NEW

**Severity:** 🔴 CRITICAL (same IDOR class as C5 original)

Already described in detail under [C5](#c5-phone-validation-endpoints-have-no-ownershipdistrict-checks-️-partial-fix). Promoted here as a standalone new issue because it is a clear gap in the C5 patch that leaves the same vulnerability class open through the `create` path.

**Fix:**

```ts
// phone-validation.controller.ts — async create()
const stakeholder = await prisma.stakeholder.findUnique({ where: { id: stakeholderId } });
if (!stakeholder) throw new NotFoundError('Stakeholder');
assertStakeholderAccess(stakeholder, req.enumerator!.districts, req.enumerator!.isAdmin);
```

---

### N5. Mobile app now stores tokens using `react-native-encrypted-storage` — but the package may not be properly linked 🆕 NEW

**Severity:** 🟡 MEDIUM

**File:** `mobile/src/services/api.ts`, `mobile/src/store/slices/authSlice.ts`, `mobile/package.json`

**Problem:**

The mobile app was updated to use `react-native-encrypted-storage` instead of `AsyncStorage` for token storage — this is a good security improvement over plain `AsyncStorage`. However, `react-native-encrypted-storage` is a native module that requires linking.

The `mobile/package.json` includes `"react-native-encrypted-storage": "^4.0.3"`, but:

1. There is no `ios/Podfile` update visible in the repository showing the pod is linked (`pod install` output / `Podfile.lock` not included).
2. The Android `android/app/build.gradle` or `MainApplication` autolinking status cannot be confirmed from the repo contents.

If the native module is not linked, the app will crash at startup on any call to `EncryptedStorage.getItem` / `EncryptedStorage.setItem` with a "native module not found" error — meaning no enumerator can log in.

**Fix:**

After `npm install`, run:

```bash
cd mobile/ios && pod install   # iOS
# Android: autolinks via react-native >= 0.60, verify in android/settings.gradle
```

Verify in `mobile/ios/Podfile.lock` that `RNEncryptedStorage` appears in the resolved pods. If testing in a React Native simulator build fails with "module not found", the linking step was missed.

---

## Summary Table

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| C1 | Hardcoded fallback JWT secret | 🔴 CRITICAL | ✅ Fixed |
| C2 | Survey IDOR — no district check | 🔴 CRITICAL | ✅ Fixed |
| C3 | Media endpoints — no ownership/district checks | 🔴 CRITICAL | ✅ Fixed |
| C4 | Media upload auto-creates surveys (lock bypass) | 🔴 CRITICAL | ✅ Fixed |
| C5 | Phone validation — no ownership/district checks | 🔴 CRITICAL | ⚠️ Partial — `create` endpoint still unprotected (see N4) |
| C6 | Stakeholder district editable via PATCH | 🔴 CRITICAL | ✅ Fixed |
| C7 | DB & Redis exposed with hardcoded passwords | 🔴 CRITICAL | ✅ Fixed |
| C8 | Admin panel JWT stored in `localStorage` | 🔴 CRITICAL | ❌ Not Fixed |
| H1 | Sync upload — no district check | 🟠 HIGH | ✅ Fixed |
| H2 | Refresh tokens stored in plaintext | 🟠 HIGH | ✅ Fixed |
| H3 | `updateStatus` broken enum validation | 🟠 HIGH | ✅ Fixed (but see N3 — new access control gap) |
| H4 | MIME type sniffing trusts client header only | 🟠 HIGH | ✅ Fixed |
| H5 | Uploaded filenames unsanitized in S3 key | 🟠 HIGH | ✅ Fixed |
| H6 | `facilities.controller.ts` bypasses error handler | 🟠 HIGH | ✅ Fixed |
| H7 | No per-account login lockout | 🟠 HIGH | ⚠️ Partial — in-memory only, not Redis |
| M1 | 50MB body limit applied globally | 🟡 MEDIUM | ✅ Fixed |
| M2 | No sync batch size cap | 🟡 MEDIUM | ✅ Fixed |
| M3 | CORS allows localhost in production | 🟡 MEDIUM | ✅ Fixed |
| M4 | Dashboard leaks global sync counts | 🟡 MEDIUM | ✅ Fixed (but see N1 — column missing) |
| M5 | No centralized request validation / length limits | 🟡 MEDIUM | ❌ Not Fixed |
| M6 | HTTPS/HSTS not enforced | 🟡 MEDIUM | ✅ Fixed |
| M7 | Hardcoded mobile API base URL | 🟡 MEDIUM | ⚠️ Partial — `react-native-config` not installed |
| L1 | No password strength policy | 🟢 LOW | ✅ Fixed |
| L2 | No mobile TLS certificate pinning | 🟢 LOW | ❌ Not Fixed |
| L3 | No automated dependency scanning in CI | 🟢 LOW | ⚠️ Partial — backend only, no CI integration |
| L4 | Log PII redaction | 🟢 LOW | ❌ Not Fixed |
| L5 | Session rows never purged | 🟢 LOW | ✅ Fixed |
| L6 | Media delete non-atomic | 🟢 LOW | ⚠️ Partial — `deletedAt` not in schema (breaks delete endpoint, see N2) |
| **N1** | `SyncQueue.enumeratorId` missing from schema | 🟡 MEDIUM | 🆕 New — dashboard 500s for all non-admins |
| **N2** | `media.delete` broken — `deletedAt` not in schema | 🔴 CRITICAL | 🆕 New — delete endpoint 500s on every call |
| **N3** | `updateStatus` accessible by any enumerator | 🟠 HIGH | 🆕 New — no admin guard on status route |
| **N4** | `phone-validation/create` has no district check | 🔴 CRITICAL | 🆕 New — C5 patch left `create` path open |
| **N5** | `react-native-encrypted-storage` may not be linked | 🟡 MEDIUM | 🆕 New — app may crash at login on device |

---

## Recommended Immediate Actions (Before Deployment)

In priority order, these are the items that will prevent crashes or represent active security holes:

1. **N2 — Add `deletedAt` to `Media` schema and migrate.** The delete endpoint is broken right now. Every `DELETE /media/:id` call throws a 500. This is a data-integrity regression from the L6 fix.

2. **N1 — Add `enumeratorId` to `SyncQueue` schema and migrate.** Dashboard stats 500 for all non-admin users due to M4's filter referencing a non-existent column.

3. **N4 / C5 — Add `assertStakeholderAccess` to `phone-validation/create`.** The read and update paths are now protected, but the write path is still an IDOR.

4. **N3 — Restrict `PATCH /stakeholders/:id/status` to admins only.** Any enumerator can currently force-close or force-reopen any stakeholder in their district, bypassing all survey completion requirements.

5. **C8 — Add CSP to Helmet config for admin panel.** Minimum viable mitigation until httpOnly cookies are implemented.

6. **H7 — Migrate in-memory lockout to Redis.** Current implementation works for single-instance but silently fails to protect against distributed attacks or server restarts.

7. **M7 — Install `react-native-config` and link `react-native-encrypted-storage`.** Without these, production mobile builds will either point at the test backend or crash at startup.