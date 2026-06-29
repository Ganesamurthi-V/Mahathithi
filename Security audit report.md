# MahaAtithi — Security Audit Report (v2)

**Source:** `Mahathithi-feature-sqlite__1_.zip`  
**Scope:** Full codebase — `backend/`, `admin-panel/`, `mobile/`, `docker-compose.yml`, `prisma/schema.prisma`  
**Context:** This is the third review pass. The previous two audits identified issues C1–C8, H1–H7, M1–M7, L1–L6, and new issues N1–N5. This report gives the final status of every item and documents any remaining or new findings.

**Severity legend:**
- 🔴 **CRITICAL** — exploitable today, leads to data compromise or full account takeover
- 🟠 **HIGH** — serious access-control or data-integrity gap
- 🟡 **MEDIUM** — real risk but needs specific conditions or is lower-impact
- 🟢 **LOW** — hygiene / defence-in-depth

---

## Summary: What Changed

All four crash-causing regressions from the last review (N1–N4) are confirmed fixed. The three previously open critical/high issues (C8, H7, N3) have partial or full fixes applied. The codebase is now in materially better shape than the first pass. What remains are four unfixed items and four newly identified issues.

---

## Status of All Previously Reported Issues

| ID | Title | Previous | Now |
|----|-------|----------|-----|
| C1 | Hardcoded fallback JWT secret | ✅ Fixed | ✅ Fixed |
| C2 | Survey IDOR — no district check | ✅ Fixed | ✅ Fixed |
| C3 | Media endpoints — no ownership/district | ✅ Fixed | ✅ Fixed |
| C4 | Media upload auto-creates surveys (lock bypass) | ✅ Fixed | ✅ Fixed |
| C5 | Phone validation — no ownership/district | ⚠️ Partial | ✅ Fixed |
| C6 | Stakeholder district editable via PATCH | ✅ Fixed | ✅ Fixed |
| C7 | DB & Redis with hardcoded passwords, ports exposed | ✅ Fixed | ✅ Fixed |
| C8 | Admin panel JWT in `localStorage` | ❌ Not Fixed | ⚠️ Partial (CSP added, token still in localStorage) |
| H1 | Sync upload — no district check | ✅ Fixed | ✅ Fixed |
| H2 | Refresh tokens stored in plaintext | ✅ Fixed | ✅ Fixed |
| H3 | `updateStatus` broken enum + no access guard | ✅ Fixed (enum) | ✅ Fixed (both enum and admin-only guard) |
| H4 | MIME type sniffing trusts client header | ✅ Fixed | ✅ Fixed |
| H5 | Uploaded filenames in S3 key unsanitized | ✅ Fixed | ✅ Fixed |
| H6 | `facilities.controller` bypasses error handler | ✅ Fixed | ✅ Fixed |
| H7 | No per-account login lockout | ⚠️ Partial (in-memory) | ⚠️ Partial (still in-memory, not Redis) |
| M1 | 50MB body limit global | ✅ Fixed | ✅ Fixed |
| M2 | No sync batch size cap | ✅ Fixed | ✅ Fixed |
| M3 | CORS allows localhost in production | ✅ Fixed | ✅ Fixed |
| M4 | Dashboard leaks global sync counts | ✅ Fixed | ✅ Fixed |
| M5 | No centralized request validation / length limits | ❌ Not Fixed | ❌ Not Fixed |
| M6 | HTTPS/HSTS not enforced | ✅ Fixed | ✅ Fixed |
| M7 | Hardcoded mobile API base URL | ⚠️ Partial | ⚠️ Partial (`react-native-config` still not installed) |
| L1 | No password strength policy | ✅ Fixed | ✅ Fixed |
| L2 | No mobile TLS certificate pinning | ❌ Not Fixed | ❌ Not Fixed |
| L3 | No automated dependency scanning in CI | ⚠️ Partial | ⚠️ Partial (backend only, no CI wiring, no admin-panel/mobile scripts) |
| L4 | Log PII redaction | ❌ Not Fixed | ❌ Not Fixed |
| L5 | Session rows never purged | ✅ Fixed | ✅ Fixed |
| L6 | Media delete non-atomic (schema mismatch) | ⚠️ Broken | ✅ Fixed |
| N1 | `SyncQueue.enumeratorId` missing from schema | 🆕 Crash | ✅ Fixed |
| N2 | `media.delete` broken — `deletedAt` not in schema | 🆕 Crash | ✅ Fixed |
| N3 | `updateStatus` accessible by any enumerator | 🆕 HIGH | ✅ Fixed |
| N4 | `phone-validation/create` no district check | 🆕 CRITICAL | ✅ Fixed |
| N5 | `react-native-encrypted-storage` may not be linked | 🆕 MEDIUM | ✅ Fixed (Podfile uses `use_native_modules!`) |

---

## Remaining Issues (Unfixed or Partially Fixed)

---

### 1. Admin panel JWT still stored in `localStorage` ⚠️ PARTIAL — C8

**Severity:** 🔴 CRITICAL (unchanged from original)

**Files:** `admin-panel/src/App.tsx`, `admin-panel/src/api.ts`

**What was done:** A Content-Security-Policy was added to the backend's Helmet config:

```ts
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", 'https://mahaatithi.gov.in'],
      imgSrc: ["'self'", 'data:', 'https:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));
```

This meaningfully reduces XSS surface. However, the admin panel still reads and writes the access token and refresh token directly to `localStorage`:

```ts
// admin-panel/src/App.tsx — unchanged
localStorage.setItem('admin_token', tokens.accessToken);
localStorage.setItem('admin_refresh', tokens.refreshToken);
```

```ts
// admin-panel/src/api.ts — unchanged
const token = localStorage.getItem('admin_token');
```

Any JavaScript injected into the admin panel page — via a compromised npm package, a third-party script, a future feature that embeds user content, or a CSP misconfiguration — can read the admin token directly. The CSP is a meaningful reduction in probability, not an elimination of the risk.

**What the CSP doesn't cover:**
- `'unsafe-inline'` in `styleSrc` means inline styles can load external resources on some browsers, which can be used as a CSS injection vector.
- The CSP on the backend API only applies when the browser requests `/api/*` endpoints. If the admin panel is served from a separate origin (Vercel, Netlify, Railway static), the backend's Helmet config doesn't affect the admin panel's document at all — the CSP must be on the response that serves `index.html`.

**Proper fix — move admin session to httpOnly cookies:**

```ts
// backend auth.controller.ts — on login:
res.cookie('admin_session', tokens.accessToken, {
  httpOnly: true,       // JS cannot read this
  secure: true,         // HTTPS only
  sameSite: 'strict',   // no cross-site request inclusion
  maxAge: 15 * 60 * 1000,
});
res.json({ success: true, data: { enumerator } }); // no token in body
```

```ts
// admin-panel/src/api.ts — remove the Authorization interceptor, add:
const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // cookie sent automatically
});
```

---

### 2. Per-account login lockout uses in-memory Map instead of Redis ⚠️ PARTIAL — H7

**Severity:** 🟠 HIGH

**File:** `backend/src/modules/auth/auth.service.ts`

**What was done:** A per-account lockout was added using a module-level `Map<string, LockoutEntry>`. This is a real improvement — a single attacker from a single IP can no longer brute-force any account. The comment in the code even explains the Redis upgrade path.

**What is still wrong:**

The code comment says "safe for single-instance Node processes." That qualifier is the problem:

1. **Multi-instance deployments:** Railway, Render, and similar platforms will run at least two instances during deploys (blue/green rollover). An attacker sending 4 requests per instance never triggers a lockout. The lockout Map is not shared between processes.

2. **Server restart clears all lockout state:** A deploy, a crash, or a daily restart by the platform resets every lockout counter. An attacker watching deployment schedules can time attacks to coincide with restarts.

3. **Memory leak:** The `Map` is never pruned. The `clearFailures` function only runs on successful login. A failed loginId that never successfully authenticates (e.g. a wordlist of non-existent accounts) leaves entries in the Map forever. Under a credential-stuffing attack, this grows unboundedly.

Redis is already running in the stack, the URL is already configured (`config.redis.url`), and the recommended fix was in the original audit report.

**Fix:**

```ts
// backend/src/config/redis.ts
import { createClient } from 'redis';
import { config } from './index';

export const redisClient = createClient({ url: config.redis.url });
redisClient.connect().catch(err => {
  console.error('[Redis] Failed to connect:', err);
});

// backend/src/modules/auth/auth.service.ts
import { redisClient } from '../../config/redis';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60;

async function checkLocked(loginId: string): Promise<void> {
  const locked = await redisClient.get(`login_lock:${loginId}`);
  if (locked) throw new UnauthorizedError('Account temporarily locked. Try again in 15 minutes.');
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

### 3. No centralized request validation — free-text fields have no length limits ❌ NOT FIXED — M5

**Severity:** 🟡 MEDIUM

**Files:** All controllers

**Status:** `zod` is listed in `backend/package.json` dependencies but is not used anywhere in `backend/src/`. No `*.schema.ts` files exist. No `.parse()` or `.safeParse()` calls appear in any controller or route. Validation remains hand-rolled and inconsistent across modules.

**What this means in practice:** Every free-text field — `notes`, `remarks`, `contactPerson`, `addressLine1`, `website`, `gstNumber`, and others — accepts strings of arbitrary length. With the global body limit at 1MB (M1 fix), a single field can still receive ~900KB of text, creating oversized Postgres rows, inflated S3 metadata, and potential issues in any code that processes or displays field values without truncation.

**Fix — add Zod schemas (example):**

```ts
// backend/src/modules/survey/survey.schema.ts
import { z } from 'zod'; // already in package.json

export const createOrUpdateSurveySchema = z.object({
  stakeholderId: z.string().uuid(),
  contactPerson:  z.string().max(200).optional(),
  mobileNumber:   z.string().max(20).optional(),
  email:          z.string().email().max(200).optional(),
  website:        z.string().url().max(500).optional(),
  notes:          z.string().max(2000).optional(),
  remarks:        z.string().max(2000).optional(),
  gstNumber:      z.string().max(15).optional(),
  latitude:       z.number().min(-90).max(90).optional(),
  longitude:      z.number().min(-180).max(180).optional(),
});

// survey.controller.ts
import { createOrUpdateSurveySchema } from './survey.schema';

async createOrUpdate(req, res, next) {
  try {
    const parsed = createOrUpdateSurveySchema.parse(req.body); // ZodError → 400
    ...
  }
}
```

Also add a `ZodError` branch in `error-handler.ts` so validation failures return clean 400 responses rather than 500s.

---

### 4. Mobile API base URL configuration is incomplete ⚠️ PARTIAL — M7

**Severity:** 🟡 MEDIUM

**File:** `mobile/src/services/api.ts`

**Current code:**

```ts
const API_BASE = (globalThis as any).__ENV__?.API_BASE_URL
  || (__DEV__ ? 'https://mahathithi-test.up.railway.app/api' : '');

if (!API_BASE) {
  throw new Error('[CONFIG] API_BASE_URL is not set...');
}
```

**What is good:** Production builds will crash at startup if `API_BASE_URL` is not injected, preventing accidental production builds pointing at the test server.

**What is still incomplete:** `react-native-config` is not in `mobile/package.json`. The `(globalThis as any).__ENV__` pattern requires a custom Metro plugin or build-time environment injection that is not set up in the repo. Without it, `__ENV__` is always `undefined`, so every non-`__DEV__` build throws the config error immediately on startup.

**Fix:**

```bash
cd mobile
npm install react-native-config
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

## New Issues Found in This Build

---

### NEW-1. `completeSurvey` counts soft-deleted media toward completion requirements 🔴 CRITICAL

**File:** `backend/src/modules/survey/survey.service.ts`

**Problem:**

The L6/N2 fix added `deletedAt` soft-delete to `Media`. The `getBySurvey` query correctly filters `deletedAt: null`. But `completeSurvey` fetches media via a Prisma `include` with no filter:

```ts
const survey = await prisma.survey.findUnique({
  where: { id: surveyId },
  include: {
    media: true,   // ❌ no deletedAt: null filter — includes soft-deleted records
    ...
  },
});

// Then later:
const photos = survey.media.filter(m => m.type === 'PHOTO');
if (photos.length < 1) {
  validationErrors.push('Minimum 1 photo required...');
}
```

**Impact:** A soft-deleted photo (one that was deleted after upload but whose S3 delete failed, leaving a DB tombstone) is counted as a real photo. This means a survey can be marked as completed against the minimum 1 photo / 1 video requirement using media records that are tombstoned and whose S3 files may no longer exist. The completed survey will have `isCompleted: true` but reference media that isn't actually there.

Conversely, an enumerator who has photos and videos but encountered an S3 failure (leaving tombstones) and then re-uploaded replacements might find their valid photos don't satisfy the count if the counter over-counts tombstones. This is a data integrity bug either way.

**Fix:**

```ts
// survey.service.ts — completeSurvey
const survey = await prisma.survey.findUnique({
  where: { id: surveyId },
  include: {
    media: {
      where: { deletedAt: null },  // ADD THIS — exclude soft-deleted tombstones
    },
    stakeholder: {
      include: {
        phoneValidations: { where: { enumeratorId } },
      },
    },
  },
});
```

---

### NEW-2. `android/local.properties` contains a developer's personal file path and is committed to the repo 🟡 MEDIUM

**File:** `mobile/android/local.properties`

**Content:**

```
sdk.dir=C:\Users\fosec\AppData\Local\Android\Sdk
```

This file contains an absolute path to a developer's machine (`fosec` is the username). It is **committed to version control** and is not in the root `.gitignore` (which excludes `.gradle`, `app/build`, and `build/` — but not `local.properties`). The Android `.gitignore` at `mobile/android/.gitignore` does not exist.

**Why this matters:**

1. It leaks the username of a developer (`fosec`), which is a social-engineering / OSINT asset if the project ever becomes public or is reviewed by an adversary.
2. `local.properties` should never be in version control — it's machine-specific and the standard `.gitignore` template for Android explicitly excludes it. Every developer cloning this repo will have their Android builds fail unless they overwrite this file with their own SDK path.

**Fix:**

```bash
# Remove from git tracking
git rm --cached mobile/android/local.properties
```

```
# Add to .gitignore (root level or mobile/android/.gitignore):
mobile/android/local.properties
```

---

### NEW-3. Verbose `console.log` statements dump full survey PII payloads in production mobile builds 🟠 HIGH

**Files:** `mobile/src/store/slices/syncThunks.ts` (line 265), `mobile/src/screens/survey/SurveyFormScreen.tsx` (line 769)

**Problem:**

```ts
// syncThunks.ts:265
console.log(`📤 [Sync] Uploading text payload for survey ${localSurveyId}:`,
  JSON.stringify(surveyPayload, null, 2));

// SurveyFormScreen.tsx:769
console.log('📤 [Survey Online] Uploading text payload:',
  JSON.stringify(surveyPayload, null, 2));
```

`surveyPayload` contains the full survey data: `contactPerson`, `mobileNumber`, `email`, `mobileNumber2`, `email2`, `gstNumber`, `latitude`, `longitude`, `notes`, and `remarks` — i.e., the full PII record being collected.

**Why this matters in production:**

React Native `console.log` statements are not stripped from release builds by default. On Android, they appear in `adb logcat` — accessible to any app with `READ_LOGS` permission or to anyone with physical USB access to the device. On iOS, they appear in device system logs accessible via Xcode / Console.app on a connected device.

For a field app collecting business PII on behalf of the Maharashtra government, this means every survey submission — including names, phone numbers, GPS coordinates, and GST numbers — is written in plaintext to the device system log during the upload flow.

**Fix:**

Wrap all verbose logs in a `__DEV__` guard so they are only emitted in debug builds:

```ts
// Option 1: wrap each call
if (__DEV__) {
  console.log(`📤 [Sync] Uploading text payload...`, JSON.stringify(surveyPayload, null, 2));
}

// Option 2: create a dev-only logger utility
// mobile/src/utils/devLog.ts
export const devLog = (...args: any[]) => {
  if (__DEV__) console.log(...args);
};
```

Or use a Metro/Babel plugin (`babel-plugin-transform-remove-console`) that strips all `console.*` calls from release builds:

```js
// babel.config.js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  env: {
    production: {
      plugins: ['transform-remove-console'],
    },
  },
};
```

---

### NEW-4. `admin-panel` and `mobile` have no `npm audit` script — dependency vulnerabilities go undetected 🟢 LOW

**Files:** `admin-panel/package.json`, `mobile/package.json`

The previous audit added `"audit": "npm audit --production"` to `backend/package.json`, but neither of the other two packages received the same treatment. The admin panel runs in a browser and handles the most privileged operations in the system; the mobile app runs on untrusted field devices. Vulnerable dependencies in either are higher-risk than in the backend.

Additionally, no CI step (GitHub Actions, Railway job, etc.) runs `npm audit` automatically. The script exists in the backend but must be run manually.

**Fix:**

```json
// admin-panel/package.json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "audit": "npm audit --production"
}

// mobile/package.json
"scripts": {
  ...
  "audit": "npm audit --production"
}
```

And a GitHub Actions workflow:

```yaml
# .github/workflows/audit.yml
name: Dependency Audit
on: [push, pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm audit --production
        working-directory: backend
      - run: npm audit --production
        working-directory: admin-panel
      - run: npm audit --production
        working-directory: mobile
```

---

## Items Still Pending from Prior Audits (Not New, Not Fixed)

These were noted in prior reports and remain open. They are documented here for completeness but carry the same recommendations as before.

**L2 — No mobile TLS certificate pinning:** No TLS pinning library added. Low priority for initial launch but relevant for a PII-collecting field app on untrusted networks.

**L4 — Log PII redaction:** Backend Winston logger has no redaction configuration. `loginId` and operational detail appear in log messages. Not an issue today since no external log sink is configured, but should be addressed before any log shipping is wired up.

**Admin-only `/stakeholders/:id/relocate` endpoint:** Still missing. The dangerous write path (district editable via PATCH) is blocked, but there is no admin UI/API path to correct a mis-tagged district without direct DB access. Track as a follow-up task.

**httpOnly cookie migration for admin panel:** The CSP added is the minimum viable mitigation. The real fix — moving the admin session to an `httpOnly`, `Secure`, `SameSite=Strict` cookie — remains unimplemented. This is the highest-value remaining security work.

---

## Immediate Action Priority

In order of impact:

1. **NEW-1** — Fix `completeSurvey` to filter `deletedAt: null` on its `media` include. One line change; currently causes completed surveys to be validated against phantom media.

2. **C8 / httpOnly cookies** — Move the admin session out of `localStorage`. The CSP is a meaningful partial fix but not a sufficient one for the highest-privilege client in the system.

3. **NEW-3** — Wrap `console.log(JSON.stringify(surveyPayload))` in `__DEV__` guards or strip via Babel. PII is currently written to device system logs on every sync in production builds.

4. **NEW-2** — Remove `android/local.properties` from git and add to `.gitignore`.

5. **H7** — Migrate per-account lockout from in-memory `Map` to Redis for correctness under multi-instance / restart scenarios.

6. **M7** — Install `react-native-config` and wire it into the mobile build. Without it, production release builds throw a config error at startup.

7. **M5** — Add Zod schemas for free-text field length limits. `zod` is already in `package.json`; it just needs to be used.