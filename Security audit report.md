# MahaAtithi — Security & Backend Audit Report

**Scope:** `backend/` (Express + Prisma + PostgreSQL), `admin-panel/` (React + Vite), `mobile/` (React Native network layer), and infrastructure config (`docker-compose.yml`, `.env.example`).

**Method:** Manual line-by-line review of every route, controller, service, middleware, the Prisma schema, and the deployment config. Each finding below includes the exact file, the problem, why it matters, and a concrete code-level fix.

**Severity legend:**
- 🔴 **CRITICAL** — exploitable today, leads to full account/data compromise or system exposure
- 🟠 **HIGH** — serious access-control or data-integrity gap, exploitable by any authenticated user
- 🟡 **MEDIUM** — real risk or correctness bug, but needs specific conditions or is lower-impact
- 🟢 **LOW** — hygiene / defense-in-depth / maintainability

---

## Table of Contents

1. [Critical Issues](#critical-issues)
2. [High Issues](#high-issues)
3. [Medium Issues](#medium-issues)
4. [Low / Hygiene Issues](#low--hygiene-issues)
5. [Recommended Shared Fix (root cause for C2–C6, H1)](#recommended-shared-fix)
6. [Production Readiness Checklist](#production-readiness-checklist)

---

## Critical Issues

### C1. Hardcoded fallback JWT secret

**File:** `backend/src/config/index.ts`

**Problem**
```ts
jwt: {
  secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  ...
}
```
If `JWT_SECRET` is unset at deploy time (very easy to miss on Railway/Render/Docker), the server boots **silently** using a string that is sitting in this public repository. Anyone who reads the source can forge a valid JWT with `isAdmin: true` and get full administrative access — create/delete enumerators, reassign districts, read every record.

There is no startup validation for `DATABASE_URL` either — it's asserted with `!` (a TypeScript-only, not a runtime, guarantee).

**Impact:** Full system takeover if the env var is ever missing. This is the single highest-impact item in this report because it has zero attacker effort — it's a config mistake away from "game over."

**Fix** — fail fast at boot instead of falling back silently:
```ts
// backend/src/config/index.ts
function requireEnv(name: string, minLength = 0): string {
  const value = process.env[name];
  if (!value || value.length < minLength) {
    throw new Error(
      `Missing or invalid required environment variable: ${name}` +
      (minLength ? ` (must be at least ${minLength} characters)` : '')
    );
  }
  return value;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  database: {
    url: requireEnv('DATABASE_URL'),
  },

  jwt: {
    secret: requireEnv('JWT_SECRET', 32),
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },

  // ...rest unchanged, but consider requireEnv() for AWS creds in production too
};
```
Add a one-line check in `package.json`'s `prestart`/CI step that runs the config module so a missing var fails the deploy, not just the first request.

---

### C2. Survey create/update/read has no district or ownership check (IDOR)

**Files:** `backend/src/modules/survey/survey.routes.ts`, `survey.service.ts`

**Problem**
```ts
// survey.routes.ts
router.use(authMiddleware);
router.post('/', controller.createOrUpdate);                       // ❌ no districtGuard
router.get('/stakeholder/:stakeholderId', controller.getByStakeholder); // ❌ no districtGuard
router.post('/:id/complete', controller.complete);                 // ✅ ownership checked inside
```
`createOrUpdate` only blocks a write if the target stakeholder is `lockedById` by **someone else** — it never checks that the stakeholder is even in the caller's assigned district. `getByStakeholderId` has no check at all. Any authenticated enumerator can:
- Create/edit a survey (contact name, phone, email, GPS) for any stakeholder anywhere in the country.
- Read full survey + media details for any stakeholder, regardless of district assignment.

**Impact:** Complete bypass of the district-based access-control model for the write and read paths of the single most important entity in the system (survey data = the actual collected PII).

**Fix** — add a reusable access check (see [Recommended Shared Fix](#recommended-shared-fix)) and use it in the service layer (more robust than only guarding at the route, since `district-guard.ts` only looks at `req.params.id`/`req.params.stakeholderId`, which is true here, but it's safer to enforce in the service so the rule can't be missed by a future route):

```ts
// survey.service.ts
import { ForbiddenError, NotFoundError, ConflictError } from '../../utils/errors';
import { assertStakeholderAccess } from '../../utils/access-control';

async createOrUpdate(data: CreateSurveyData, enumeratorDistricts: string[], isAdmin: boolean) {
  const stakeholder = await prisma.stakeholder.findUnique({ where: { id: data.stakeholderId } });
  if (!stakeholder) throw new NotFoundError('Stakeholder');

  assertStakeholderAccess(stakeholder, enumeratorDistricts, isAdmin); // throws ForbiddenError if out of district

  if (stakeholder.lockedById && stakeholder.lockedById !== data.enumeratorId) {
    throw new ConflictError('This stakeholder has been completed by another enumerator');
  }
  // ...rest unchanged
}

async getByStakeholderId(stakeholderId: string, enumeratorDistricts: string[], isAdmin: boolean) {
  const stakeholder = await prisma.stakeholder.findUnique({ where: { id: stakeholderId } });
  if (!stakeholder) throw new NotFoundError('Stakeholder');
  assertStakeholderAccess(stakeholder, enumeratorDistricts, isAdmin);

  return prisma.survey.findFirst({
    where: { stakeholderId },
    include: { media: true, stakeholder: { select: { companyNameStandardized: true, district: true, status: true } } },
  });
}
```
```ts
// survey.controller.ts — pass through the enumerator's districts/isAdmin
async createOrUpdate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { stakeholderId, ...surveyData } = req.body;
    if (!stakeholderId) throw new ValidationError('Stakeholder ID is required');

    const survey = await surveyService.createOrUpdate(
      { stakeholderId, enumeratorId: req.enumerator!.id, ...surveyData },
      req.enumerator!.districts,
      req.enumerator!.isAdmin
    );
    res.json({ success: true, data: survey });
  } catch (error) { next(error); }
}

async getByStakeholder(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const survey = await surveyService.getByStakeholderId(
      req.params.stakeholderId as string,
      req.enumerator!.districts,
      req.enumerator!.isAdmin
    );
    res.json({ success: true, data: survey });
  } catch (error) { next(error); }
}
```

---

### C3. Media endpoints have zero ownership/district checks

**File:** `backend/src/modules/media/media.controller.ts`, `media.service.ts`, `media.routes.ts`

**Problem**
```ts
router.use(authMiddleware);
router.post('/upload', uploadLimiter, upload.single('file'), controller.upload); // ❌ no ownership check
router.get('/survey/:surveyId', controller.getBySurvey);                        // ❌ no district check
router.delete('/:id', controller.delete);                                       // ❌ no ownership check at all
```
- **`getBySurvey`** returns metadata **and a freshly generated presigned S3 URL** for any survey's photos/videos to *any* logged-in enumerator — no district scoping.
- **`delete`** permanently removes the S3 object and the DB row for any media ID, for any enumerator. There's no admin check, no ownership check, nothing. Any single compromised low-privilege account can wipe evidentiary photos/videos across the entire dataset.
- **`upload`** never verifies `survey.enumeratorId === data.enumeratorId`, and never checks whether the parent stakeholder is locked/closed — media can be appended to someone else's already-completed survey.

**Impact:** Mass data destruction (delete), PII/photo exposure (getBySurvey), and evidence tampering (upload) — all from a single low-privilege account, with no admin role required.

**Fix:**
```ts
// media.service.ts
async assertOwnership(surveyId: string, enumeratorId: string, isAdmin: boolean) {
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    include: { stakeholder: { select: { lockedById: true, status: true } } },
  });
  if (!survey) throw new NotFoundError('Survey');
  if (!isAdmin && survey.enumeratorId !== enumeratorId) {
    throw new ForbiddenError('You do not have access to this survey');
  }
  if (survey.stakeholder.status === 'CLOSED' && survey.stakeholder.lockedById !== enumeratorId && !isAdmin) {
    throw new ConflictError('This stakeholder has been completed and locked by another enumerator');
  }
  return survey;
}

async upload(data: UploadMediaData, isAdmin: boolean) {
  // ...existing survey resolution logic...
  await this.assertOwnership(resolvedSurveyId, data.enumeratorId, isAdmin);
  // ...rest unchanged
}

async getBySurvey(surveyId: string, enumeratorId: string, districts: string[], isAdmin: boolean) {
  const survey = await prisma.survey.findUnique({ where: { id: surveyId }, include: { stakeholder: true } });
  if (!survey) throw new NotFoundError('Survey');
  if (!isAdmin) {
    const inDistrict = districts.some(d => d.toUpperCase() === survey.stakeholder.district?.toUpperCase());
    if (!inDistrict) throw new ForbiddenError('Not assigned to this district');
  }
  const media = await prisma.media.findMany({ where: { surveyId }, orderBy: { capturedAt: 'asc' } });
  for (const item of media) item.fileUrl = await getPresignedUrl(item.filePath);
  return media;
}

async delete(mediaId: string, enumeratorId: string, isAdmin: boolean) {
  const media = await prisma.media.findUnique({ where: { id: mediaId }, include: { survey: true } });
  if (!media) throw new NotFoundError('Media');
  if (!isAdmin && media.survey.enumeratorId !== enumeratorId) {
    throw new ForbiddenError('You do not have access to this media');
  }
  await deleteFromS3(media.filePath);
  await prisma.media.delete({ where: { id: mediaId } });
}
```
```ts
// media.controller.ts — thread through req.enumerator
async upload(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    // ...existing validation...
    const media = await mediaService.upload({ enumeratorId: req.enumerator!.id, /* ... */ }, req.enumerator!.isAdmin);
    res.json({ success: true, data: media });
  } catch (error) { next(error); }
}

async getBySurvey(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const media = await mediaService.getBySurvey(
      req.params.surveyId as string, req.enumerator!.id, req.enumerator!.districts, req.enumerator!.isAdmin
    );
    res.json({ success: true, data: media });
  } catch (error) { next(error); }
}

async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    await mediaService.delete(req.params.id as string, req.enumerator!.id, req.enumerator!.isAdmin);
    res.json({ success: true, message: 'Media deleted' });
  } catch (error) { next(error); }
}
```

---

### C4. Media upload auto-creates surveys for arbitrary stakeholders (lock bypass)

**File:** `backend/src/modules/media/media.service.ts`

**Problem**
```ts
const stakeholderId = data.surveyId.startsWith('draft_') ? data.surveyId.replace('draft_', '') : null;
if (stakeholderId) {
  const existingSurvey = await prisma.survey.findFirst({ where: { stakeholderId }, orderBy: { updatedAt: 'desc' } });
  if (existingSurvey) {
    resolvedSurveyId = existingSurvey.id;
  } else {
    const newSurvey = await prisma.survey.create({
      data: { stakeholderId, enumeratorId: data.enumeratorId, isDraft: true, isSynced: true }
    });
    resolvedSurveyId = newSurvey.id;
  }
}
```
Calling `/media/upload` with `surveyId = "draft_<any-stakeholder-id>"` silently creates a brand-new `Survey` row owned by the caller for **any** stakeholder — including ones outside their district or already locked by another enumerator. This recreates the exact IDOR that the lock-check in `SurveyService.createOrUpdate` was meant to prevent, just through a side door.

**Impact:** Full bypass of C2's fix if this path isn't patched too — this is the same vulnerability class smuggled in through a different endpoint.

**Fix:** Run the same access check used in C2/C3 before auto-creating:
```ts
if (stakeholderId && !existingSurvey) {
  const stakeholder = await prisma.stakeholder.findUnique({ where: { id: stakeholderId } });
  if (!stakeholder) throw new NotFoundError('Stakeholder');
  assertStakeholderAccess(stakeholder, callerDistricts, isAdmin); // see shared fix below
  if (stakeholder.lockedById && stakeholder.lockedById !== data.enumeratorId) {
    throw new ConflictError('This stakeholder has been completed by another enumerator');
  }
  const newSurvey = await prisma.survey.create({
    data: { stakeholderId, enumeratorId: data.enumeratorId, isDraft: true, isSynced: true }
  });
  resolvedSurveyId = newSurvey.id;
}
```
(This requires threading `callerDistricts`/`isAdmin` into `mediaService.upload`, same as C3's fix.)

---

### C5. Phone validation endpoints have no ownership/district checks, and inconsistent status validation

**File:** `backend/src/modules/phone-validation/phone-validation.controller.ts`

**Problem**
```ts
async create(req, res, next) {
  // ✅ validates status enum
}
async getByStakeholder(req, res, next) {
  // ❌ no district check — returns any stakeholder's phone validation history to anyone
}
async update(req, res, next) {
  const { status, remarks } = req.body;
  // ❌ no enum validation on status at all
  // ❌ no ownership check — anyone can flip anyone's record to VERIFIED
  const validation = await prisma.phoneValidation.update({ where: { id: req.params.id as string }, data: { status, remarks, ... } });
}
```
**Impact:** Any enumerator can read phone-verification history for stakeholders outside their district, and can write an arbitrary string into `status` (or maliciously mark any record `VERIFIED`) for any record ID.

**Fix:**
```ts
import { VerificationStatus } from '@prisma/client';

async getByStakeholder(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const stakeholder = await prisma.stakeholder.findUnique({ where: { id: req.params.stakeholderId as string } });
    if (!stakeholder) throw new NotFoundError('Stakeholder');
    assertStakeholderAccess(stakeholder, req.enumerator!.districts, req.enumerator!.isAdmin);

    const validations = await prisma.phoneValidation.findMany({
      where: { stakeholderId: req.params.stakeholderId as string },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: validations });
  } catch (error) { next(error); }
}

async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { status, remarks } = req.body;
    const allowedStatuses = Object.values(VerificationStatus);
    if (status && !allowedStatuses.includes(status)) {
      throw new ValidationError('Invalid verification status');
    }

    const existing = await prisma.phoneValidation.findUnique({ where: { id: req.params.id as string } });
    if (!existing) throw new NotFoundError('Phone validation');
    if (!req.enumerator!.isAdmin && existing.enumeratorId !== req.enumerator!.id) {
      throw new ForbiddenError('You can only update your own phone verification records');
    }

    const validation = await prisma.phoneValidation.update({
      where: { id: req.params.id as string },
      data: { status, remarks, verifiedAt: status === 'VERIFIED' ? new Date() : undefined },
    });
    res.json({ success: true, data: validation });
  } catch (error) { next(error); }
}
```

---

### C6. Stakeholder `district`/`state` are editable through the "safe fields" PATCH (privilege escalation)

**File:** `backend/src/modules/stakeholder/stakeholder.service.ts` → `updateStakeholder`

**Problem**
```ts
const allowedFields = [
  'companyNameStandardized', 'addressLine1', 'addressLine2',
  'city', 'taluka', 'village', 'district', 'state', 'pinCode', 'category'  // ❌ district/state here
];
```
District is the entire access-control boundary for this app (`districtGuard`, `getDistrictFilter`, every service-layer check). Letting a regular enumerator change a stakeholder's `district`/`state` via `PATCH /stakeholders/:id` lets them re-assign a record into (or out of) their own jurisdiction at will — a direct way around the access-control model, not just a data-quality bug.

**Impact:** Any enumerator can grant themselves access to any stakeholder by editing its district to match their own assignment, completely defeating district-based isolation.

**Fix:**
```ts
// stakeholder.service.ts
const allowedFields = [
  'companyNameStandardized', 'addressLine1', 'addressLine2',
  'city', 'taluka', 'village', 'pinCode', 'category',
  // district & state intentionally removed — admin-only operation, see below
];
```
Add an admin-only route for the rare legitimate case (e.g. correcting a mis-tagged district during data cleanup):
```ts
// admin.routes.ts
router.patch('/stakeholders/:id/relocate', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { district, state } = req.body;
    if (!district) throw new ValidationError('district is required');
    const updated = await prisma.stakeholder.update({
      where: { id: req.params.id as string },
      data: { district, state },
    });
    await prisma.auditLog.create({
      data: { action: 'stakeholder_relocated', entityType: 'stakeholder', entityId: req.params.id as string,
              enumeratorId: req.enumerator!.id, details: { district, state } },
    });
    res.json({ success: true, data: updated });
  } catch (error) { next(error); }
});
```

---

### C7. Database & cache exposed with a hardcoded default password / no auth

**File:** `docker-compose.yml`

**Problem**
```yaml
postgres:
  environment:
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-MahaAtithi@2024Secure}   # ❌ real-looking password as a fallback, in source control
  ports:
    - "5432:5432"   # ❌ published to the host

redis:
  ports:
    - "6379:6379"   # ❌ published, and redis.conf has no requirepass anywhere
```
A real password is committed as the default fallback, and both Postgres and Redis ports are published to the host. On a cloud VM without a strict security group / firewall, the entire stakeholder database (names, phone numbers, GST numbers, GPS) and the cache become reachable from the public internet — Redis with **no password at all**.

**Impact:** Direct, credential-free or trivially-default-credentialed access to the full dataset and cache from outside the application.

**Fix:**
```yaml
services:
  postgres:
    environment:
      POSTGRES_DB: mahaatithi
      POSTGRES_USER: mahaatithi_admin
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
    # Do NOT publish 5432 to the host in production — only other
    # containers on the compose network need to reach it.
    expose:
      - "5432"
    ...

  redis:
    command: ["redis-server", "--requirepass", "${REDIS_PASSWORD:?REDIS_PASSWORD must be set}"]
    expose:
      - "6379"
    ...
```
And update `backend/src/config/index.ts`'s `redis.url` to include the password (`redis://:${REDIS_PASSWORD}@host:6379`). If remote DB access is genuinely needed for ops, use an SSH tunnel or a managed DB with network-level allowlisting instead of opening the port.

---

### C8. Admin panel stores its JWT in `localStorage`

**File:** `admin-panel/src/api.ts`, `admin-panel/src/App.tsx`

**Problem**
```ts
const token = localStorage.getItem('admin_token');
```
The admin panel is the highest-privilege client in the system (create/delete enumerators, reassign districts, view all audit logs, edit any stakeholder). `localStorage` is readable by any JavaScript executing on the page — one XSS bug (a dependency, a future feature, a misconfigured CSP) is a full admin account takeover, and the token persists across tab/browser restarts.

**Fix (incremental, no backend redesign needed today):**
1. Add a strict Content-Security-Policy via Helmet for whatever serves the admin panel:
```ts
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", 'https://your-api-domain'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));
```
2. **Better, longer-term fix:** move the admin session to an httpOnly, `Secure`, `SameSite=Strict` cookie set by the server on login, and have the admin panel stop touching the token in JS entirely (send credentials automatically via `withCredentials: true`, validate via a `/auth/me` call). This removes the token from JS-reachable storage altogether.

---

## High Issues

### H1. Sync upload endpoint has no district check

**File:** `backend/src/modules/sync/sync.service.ts` → `processUpload`

**Problem:** Same shape as C2 — the only check is "is this stakeholder locked by someone *else*." There's no check that `surveyData.stakeholderId` actually belongs to one of the calling enumerator's assigned districts before the upsert runs.

**Fix:**
```ts
for (const surveyData of (payload.surveys || [])) {
  try {
    const stakeholder = await prisma.stakeholder.findUnique({
      where: { id: surveyData.stakeholderId },
      select: { lockedById: true, status: true, district: true },
    });
    if (!stakeholder) {
      results.surveys.failed++;
      results.surveys.errors.push(`Stakeholder ${surveyData.stakeholderId}: not found`);
      continue;
    }
    if (!isAdmin) {
      const inDistrict = districts.some(d => d.toUpperCase() === stakeholder.district?.toUpperCase());
      if (!inDistrict) {
        results.surveys.failed++;
        results.surveys.errors.push(`Stakeholder ${surveyData.stakeholderId}: outside assigned districts`);
        continue;
      }
    }
    if (stakeholder.lockedById && stakeholder.lockedById !== enumeratorId) {
      results.surveys.failed++;
      results.surveys.errors.push(`Stakeholder ${surveyData.stakeholderId}: already completed by another enumerator`);
      continue;
    }
    // ...existing upsert...
  } catch (error: any) { /* ...unchanged... */ }
}
```
(`processUpload` needs `districts: string[]` and `isAdmin: boolean` added to its signature, passed from `sync.controller.ts`'s `req.enumerator`.)

---

### H2. Refresh tokens stored in plaintext

**File:** `backend/prisma/schema.prisma` (`Session.refreshToken`), `backend/src/modules/auth/auth.service.ts`

**Problem:** Refresh tokens (valid 7 days) are stored as-is. A DB read (leak, misconfigured backup, read-replica exposure) hands an attacker fully-valid long-lived credentials for every currently-logged-in user, with no extra step required.

**Fix:**
```ts
// auth.service.ts
import crypto from 'crypto';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// on login / refresh, when creating a session:
await prisma.session.create({
  data: {
    enumeratorId: enumerator.id,
    refreshToken: hashToken(tokens.refreshToken), // store the hash, not the raw value
    deviceInfo, ipAddress, expiresAt,
  },
});

// on refresh, look up by the hash of the incoming token:
async refreshToken(refreshToken: string): Promise<TokenPair> {
  const session = await prisma.session.findUnique({
    where: { refreshToken: hashToken(refreshToken) },
    include: { enumerator: true },
  });
  // ...rest unchanged, the raw token returned to the client stays the same
}
```
The raw (unhashed) token is still what's sent to the client and used as the bearer credential — only what's persisted server-side changes.

---

### H3. `PATCH /stakeholders/:id/status` validates against the wrong enum — the endpoint cannot succeed

**File:** `backend/src/modules/stakeholder/stakeholder.controller.ts` (`updateStatus`) vs `backend/prisma/schema.prisma`

**Problem**
```ts
if (!status || !['PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED'].includes(status)) {
  throw new ValidationError('Invalid status value');
}
```
```prisma
enum StakeholderStatus {
  OPEN
  CLOSED
}
```
None of the four strings the controller validates against are legal values of `StakeholderStatus`. Any request that passes this check will throw an **unhandled Prisma enum cast error** at the database layer (`status: status as any`). This endpoint is currently non-functional for every possible input — it's dead/broken code in production right now, not just a security gap.

**Fix — pick one:**
- **Retire it.** Status changes already happen correctly through `lockStakeholder`/`completeSurvey`. If nothing calls this route, delete it.
- **Or fix it** to use the real enum and decide what it should actually do:
```ts
import { StakeholderStatus } from '@prisma/client';

async updateStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const { status } = req.body;
    const validStatuses = Object.values(StakeholderStatus); // ['OPEN', 'CLOSED']
    if (!status || !validStatuses.includes(status)) {
      throw new ValidationError(`Invalid status value. Must be one of: ${validStatuses.join(', ')}`);
    }
    const result = await stakeholderService.updateStatus(req.params.id as string, status, req.enumerator!.id);
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
}
```

---

### H4. `mediaService.upload` trusts the client-declared MIME type only

**File:** `backend/src/modules/media/media.routes.ts` (multer `fileFilter`)

**Problem:** `file.mimetype` is just the `Content-Type` header the client sends — trivially spoofable. A non-image/video file can be uploaded labeled `image/jpeg` and will be stored and later served back via a presigned URL.

**Fix** — sniff actual content after the buffer is read, in the service layer (so it can't be bypassed by hitting the route differently):
```ts
// media.service.ts
import { fileTypeFromBuffer } from 'file-type'; // npm install file-type

const ALLOWED_SIGNATURES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/3gpp'];

async upload(data: UploadMediaData, isAdmin: boolean) {
  const detected = await fileTypeFromBuffer(data.fileBuffer);
  if (!detected || !ALLOWED_SIGNATURES.includes(detected.mime)) {
    throw new ValidationError('File content does not match an allowed image/video type');
  }
  // ...rest of upload unchanged, can also use detected.mime instead of the client-supplied data.mimeType
}
```

---

### H5. Uploaded filenames used unsanitized in the S3 key

**File:** `backend/src/config/storage.ts` (`generateS3Key`), `media.controller.ts`

**Problem**
```ts
return `${type}s/${date}/${surveyId}/${fileName}`; // fileName = client's file.originalname, raw
```
Unsanitized client-supplied strings (`../`, slashes, unicode tricks) end up directly in a storage key.

**Fix:** Never use client-supplied names in the key; generate one server-side and keep the original name only as DB metadata for display:
```ts
// media.controller.ts
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
const safeFileName = `${uuidv4()}${ext}`;

const media = await mediaService.upload({
  // ...
  fileName: file.originalname,   // kept only as display metadata
  storageFileName: safeFileName, // used to build the S3 key
  // ...
});
```
```ts
// storage.ts
export function generateS3Key(type: 'photo' | 'video' | 'thumbnail', surveyId: string, storageFileName: string): string {
  const date = new Date().toISOString().split('T')[0];
  return `${type}s/${date}/${surveyId}/${storageFileName}`;
}
```

---

### H6. `facilities.controller.ts` bypasses the centralized error handler and leaks raw error messages

**File:** `backend/src/modules/facilities/facilities.controller.ts`

**Problem**
```ts
} catch (error: any) {
  res.status(500).json({ status: 'error', message: error.message }); // ❌ always raw, ignores NODE_ENV
}
```
Every other module routes errors through `errorHandler`, which hides internal messages in production. This one controller always exposes the raw error (potentially Postgres/Prisma internals — table names, constraint names) regardless of environment.

**Fix:**
```ts
export const syncOfflineFacilities = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const enumeratorId = req.enumerator?.id;
    if (!enumeratorId) throw new UnauthorizedError('Unauthorized');

    const facilities = await prisma.facility.findMany({
      select: { id: true, name: true, type: true, district: true, latitude: true, longitude: true },
    });

    res.json({ status: 'success', data: facilities });
  } catch (error) {
    next(error); // let the shared errorHandler decide what's safe to expose
  }
};
```
(Requires adding `next: NextFunction` to the route signature in `facilities.routes.ts`.)

---

### H7. No account lockout / brute-force protection beyond IP rate limiting

**File:** `backend/src/middleware/rate-limiter.ts`, `auth.service.ts`

**Problem:** `loginLimiter` is keyed by IP only (5/min, `skipSuccessfulRequests: true`). Failed logins are written to `audit_logs` but nothing acts on them. A distributed attacker (botnet, rotating IPs, or just a shared corporate NAT working in the attacker's favor) can brute-force one specific `loginId`'s password essentially unthrottled, since the limiter never looks at *which account* is being targeted.

**Fix** — add a per-account counter using Redis (already in the stack):
```ts
// auth.service.ts
import { redisClient } from '../../config/redis'; // add a small redis client wrapper if not present

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60;

async login(loginId: string, password: string, deviceInfo?: string, ipAddress?: string) {
  const lockKey = `login_lock:${loginId}`;
  const isLocked = await redisClient.get(lockKey);
  if (isLocked) {
    throw new UnauthorizedError('Account temporarily locked due to repeated failed attempts. Try again later.');
  }

  const enumerator = await prisma.enumerator.findUnique({ where: { loginId }, include: { districts: { include: { district: true } } } });
  if (!enumerator) throw new UnauthorizedError('Invalid login credentials');
  if (!enumerator.isActive) throw new UnauthorizedError('Account has been deactivated');

  const passwordValid = await bcrypt.compare(password, enumerator.passwordHash);
  if (!passwordValid) {
    const attemptsKey = `login_attempts:${loginId}`;
    const attempts = await redisClient.incr(attemptsKey);
    await redisClient.expire(attemptsKey, LOCKOUT_SECONDS);
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      await redisClient.set(lockKey, '1', { EX: LOCKOUT_SECONDS });
    }
    await prisma.auditLog.create({ data: { action: 'login_failed', entityType: 'enumerator', entityId: enumerator.id, enumeratorId: enumerator.id, ipAddress, details: { reason: 'invalid_password' } } });
    throw new UnauthorizedError('Invalid login credentials');
  }

  await redisClient.del(`login_attempts:${loginId}`); // reset on success
  // ...rest unchanged
}
```

---

## Medium Issues

### M1. `express.json({ limit: '50mb' })` applied globally

**File:** `backend/src/index.ts`

**Problem:** The 50MB limit (needed only for the sync-upload batch endpoint) is applied to every route, including `/auth/login`. Easy memory-pressure vector: many small concurrent 50MB POSTs to a cheap endpoint.

**Fix:**
```ts
// index.ts
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
```
```ts
// sync.routes.ts
import express from 'express';
router.post('/upload', express.json({ limit: '25mb' }), controller.upload);
```

---

### M2. No item-count cap on sync upload payload arrays

**File:** `backend/src/modules/sync/sync.service.ts`

**Problem:** `payload.surveys` / `payload.phoneValidations` are iterated with no length cap, generating one sequential DB round-trip per item, with no upper bound on array size within the body limit.

**Fix:**
```ts
const MAX_BATCH_ITEMS = 200;

async processUpload(enumeratorId: string, payload: SyncPayload, districts: string[], isAdmin: boolean) {
  if ((payload.surveys?.length || 0) > MAX_BATCH_ITEMS || (payload.phoneValidations?.length || 0) > MAX_BATCH_ITEMS) {
    throw new ValidationError(`Batch too large. Maximum ${MAX_BATCH_ITEMS} items per array per request.`);
  }
  // ...existing loop logic, ideally also batched with prisma.$transaction in chunks
}
```

---

### M3. CORS allowlist includes a non-HTTPS localhost origin in the production branch

**File:** `backend/src/index.ts`

**Problem**
```ts
origin: config.env === 'production'
  ? ['https://mahaatithi.gov.in', 'http://localhost:5173']  // ❌ localhost in prod list
  : [...]
```

**Fix:**
```ts
app.use(cors({
  origin: config.env === 'production'
    ? ['https://mahaatithi.gov.in']
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'],
  credentials: true,
}));
```

---

### M4. `dashboard.service.ts` leaks global sync-queue counts to non-admins

**File:** `backend/src/modules/dashboard/dashboard.service.ts`

**Problem:** `pendingSync`/`failedSync` query `syncQueue` with no scoping, so every enumerator's dashboard shows system-wide backlog counts rather than their own — inconsistent with the district-scoping used for everything else on the same endpoint.

**Fix:** Either scope to the calling enumerator's own queued items, or move these two numbers to the admin-only `/admin/analytics` endpoint where they belong:
```ts
// if scoping is the intent (most likely correct here, since sync_queue currently
// only tracks stakeholder-profile edits, not surveys/media — see SESSION_SUMMARY.md):
const [pendingSync, failedSync] = await Promise.all([
  prisma.syncQueue.count({ where: { status: 'PENDING', /* add an ownership column if one doesn't exist yet */ } }),
  prisma.syncQueue.count({ where: { status: 'FAILED' } }),
]);
```
(If `SyncQueue` doesn't currently track which enumerator triggered an item, that's a smaller follow-up: add an `enumeratorId` column to `sync_queue` so it can be scoped like everything else.)

---

### M5. No centralized request validation

**Files:** All controllers

**Problem:** Validation is hand-rolled per route and inconsistent — some check enums, some don't (H3, C5); none enforce string length limits on free-text fields (`notes`, `remarks`, `address`, etc.), allowing arbitrarily large submissions.

**Fix:** Introduce Zod schemas per route, validated at the top of each controller method:
```ts
// modules/survey/survey.schema.ts
import { z } from 'zod';

export const createOrUpdateSurveySchema = z.object({
  stakeholderId: z.string().uuid(),
  contactPerson: z.string().max(200).optional(),
  mobileNumber: z.string().max(20).optional(),
  email: z.string().email().max(200).optional(),
  notes: z.string().max(2000).optional(),
  remarks: z.string().max(2000).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  // ...etc
});
```
```ts
// survey.controller.ts
async createOrUpdate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const parsed = createOrUpdateSurveySchema.parse(req.body); // throws ZodError -> map to ValidationError in errorHandler
    const survey = await surveyService.createOrUpdate({ ...parsed, enumeratorId: req.enumerator!.id }, req.enumerator!.districts, req.enumerator!.isAdmin);
    res.json({ success: true, data: survey });
  } catch (error) { next(error); }
}
```
Add a `ZodError` branch to `error-handler.ts` so validation failures return a clean 400 with field-level detail instead of a 500.

---

### M6. HTTPS/HSTS enforcement not explicitly verified

**File:** `backend/src/index.ts`

**Problem:** Relying implicitly on the hosting platform (Railway) to terminate TLS; no explicit redirect-to-HTTPS check in the app itself.

**Fix:**
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
(Helmet's default HSTS header is already on — just confirm it isn't being stripped by a proxy in front of the app.)

---

### M7. Hardcoded backend URL baked into the mobile app bundle

**File:** `mobile/src/services/api.ts`

**Problem**
```ts
const API_BASE = 'https://mahathithi-test.up.railway.app/api'; // a "test" host, hardcoded, no per-env config
```

**Fix:** Move to build-time configuration (e.g. `react-native-config` or `.env` + `react-native-dotenv`):
```ts
// mobile/src/services/api.ts
import Config from 'react-native-config';
const API_BASE = Config.API_BASE_URL; // set per build: .env.development / .env.staging / .env.production
```
```
# .env.production
API_BASE_URL=https://api.mahaatithi.gov.in/api
```

---

## Low / Hygiene Issues

| # | Issue | Fix |
|---|---|---|
| L1 | No password strength policy enforced server-side when admins create/update enumerator accounts (`admin.routes.ts`) | Add a minimum-length/complexity check before `bcrypt.hash`, e.g. `if (password.length < 10) throw new ValidationError('Password must be at least 10 characters')` |
| L2 | No mobile TLS certificate pinning | Consider pinning for a PII-handling field app on untrusted networks (libraries: `react-native-ssl-pinning`, or platform-native pinning) |
| L3 | No automated dependency vulnerability scanning visible in the repo | Add `npm audit --production` as a CI step for `backend/`, `admin-panel/`, and `mobile/`, plus Dependabot/Renovate config |
| L4 | Logs (`logger.info`, `console.log`) include login IDs and operational detail; fine today, but no redaction policy if logs are ever shipped to a third-party sink | Add a redaction step before any external log shipping is wired up (e.g. `pino` redact paths for PII fields) |
| L5 | Expired/invalidated `Session` rows are never purged | Add a periodic cleanup job: `DELETE FROM sessions WHERE expires_at < now() OR is_valid = false` on a daily cron/worker |
| L6 | Media `delete` removes the S3 object and the DB row as two separate, non-atomic steps | Soft-delete in DB first (`deletedAt` column), garbage-collect orphaned S3 objects via a separate background job, so a partial failure can't leave one side without the other |

---

## Recommended Shared Fix

**Root cause behind C2, C3, C4, C5, C6, and H1:** every one of these is the *same* missing check — "does this stakeholder belong to a district the calling enumerator is assigned to (or are they admin)?" — applied inconsistently (or not at all) across survey, media, phone-validation, and sync. Patching each endpoint individually risks missing the next one that gets added later.

**Fix once, use everywhere** — a single shared helper:

```ts
// backend/src/utils/access-control.ts
import { ForbiddenError } from './errors';

interface StakeholderDistrictLike {
  district?: string | null;
  status?: string;
}

/**
 * Throws ForbiddenError unless the caller is admin or the stakeholder's
 * district is one of the caller's assigned districts.
 * This is the single source of truth for "can this enumerator touch this
 * stakeholder's data" — use it from every module that reads/writes
 * stakeholder-scoped data (surveys, media, phone validations, sync).
 */
export function assertStakeholderAccess(
  stakeholder: StakeholderDistrictLike,
  callerDistricts: string[],
  isAdmin: boolean
): void {
  if (isAdmin) return;

  if (!stakeholder.district) {
    throw new ForbiddenError('Stakeholder has no district assigned — admin review required');
  }

  const hasAccess = callerDistricts.some(
    d => d.toUpperCase() === stakeholder.district!.toUpperCase()
  );
  if (!hasAccess) {
    throw new ForbiddenError(`Access denied. You are not assigned to district: ${stakeholder.district}`);
  }
}
```

Then every place flagged above calls `assertStakeholderAccess(stakeholder, enumeratorDistricts, isAdmin)` right after loading the stakeholder and before doing anything else with it. This turns five separate ad-hoc patches into one well-tested function used consistently.

---

## Production Readiness Checklist

Before going live, in priority order:

- [ ] **C1** — Fail-fast env validation for `JWT_SECRET`/`DATABASE_URL`
- [ ] **C7** — Remove hardcoded DB/Redis defaults, stop publishing 5432/6379 to the host, add Redis auth
- [ ] **C8** — CSP on admin panel at minimum; httpOnly cookie session as the real fix
- [ ] **C2–C6, H1** — Roll out `assertStakeholderAccess` across survey, media, phone-validation, sync, and lock down the stakeholder PATCH field allowlist
- [ ] **H2** — Hash refresh tokens at rest
- [ ] **H3** — Fix or retire the broken `/stakeholders/:id/status` endpoint
- [ ] **H4, H5** — Real MIME sniffing + server-generated filenames for uploads
- [ ] **H6** — Route facilities errors through the shared error handler
- [ ] **H7** — Per-account login lockout via Redis
- [ ] **M1–M7** — Body size limits, CORS cleanup, validation schema rollout, env-driven mobile API base
- [ ] **L1–L6** — Password policy, dependency scanning in CI, session/log hygiene

Once the Critical and High items are resolved, this is in good shape to harden incrementally (Medium/Low) without blocking launch.