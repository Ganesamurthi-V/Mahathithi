# MahaAtithi — Security Audit Verification Report
**Source:** `Mahathithi-feature-sqlite.zip`  
**Against:** `Security_Audit_v2.md` (Third review pass)  
**Verified by:** Direct code inspection of the submitted ZIP  
**Date:** 2026-06-29

---

## TL;DR

| Category | Count |
|---|---|
| ✅ Confirmed Fixed (matches audit claim) | 28 |
| ✅ Newly Fixed (not in audit yet / beyond what audit expected) | 3 |
| ⚠️ Still Partially Fixed (matches audit's "partial" verdict) | 2 |
| ❌ Still Not Fixed (audit marked as open) | 4 |

**5 issues that the audit marked as open/partial are still not done. Details below.**

---

## What Was Verified (Issue by Issue)

### ✅ CONFIRMED FIXED — Issues the audit said are fixed and code agrees

The following issues were all confirmed fixed by code inspection. No changes needed.

| ID | Title | Evidence |
|----|-------|---------|
| C1 | Hardcoded fallback JWT secret | Environment-gated secret — no fallback string in config |
| C2 | Survey IDOR — no district check | District guard middleware present and applied |
| C3 | Media endpoints — no ownership/district | District guard applied to media routes |
| C4 | Media upload auto-creates surveys | Lock bypass path removed |
| C5 | Phone validation — no ownership/district | Full district check now enforced |
| C6 | Stakeholder district editable via PATCH | PATCH path no longer accepts `districtId` |
| C7 | DB & Redis with hardcoded passwords, ports exposed | `docker-compose.yml` uses env vars, no exposed ports |
| H1 | Sync upload — no district check | District guard on sync routes |
| H2 | Refresh tokens stored in plaintext | Tokens hashed before storage |
| H3 | `updateStatus` broken enum + no access guard | Both enum and admin-only guard fixed |
| H4 | MIME type sniffing trusts client header | Server-side MIME detection implemented |
| H5 | Uploaded filenames in S3 key unsanitized | Filenames sanitized before S3 key construction |
| H6 | `facilities.controller` bypasses error handler | Controller now calls `next(err)` correctly |
| M1 | 50MB body limit global | Body limit tightened per-route |
| M2 | No sync batch size cap | Zod schema enforces `.max(200)` on arrays |
| M3 | CORS allows localhost in production | CORS config is env-gated |
| M4 | Dashboard leaks global sync counts | Dashboard now scoped to district |
| M6 | HTTPS/HSTS not enforced | Helmet HSTS enabled in index.ts |
| L1 | No password strength policy | Zod schema enforces min-length and complexity |
| L5 | Session rows never purged | `cleanupSessions.ts` script present and scheduled |
| L6 | Media delete non-atomic (schema mismatch) | `deletedAt` field added to schema, used in delete path |
| N1 | `SyncQueue.enumeratorId` missing from schema | Field added to Prisma schema |
| N2 | `media.delete` broken — `deletedAt` not in schema | `deletedAt` field present, delete uses it |
| N3 | `updateStatus` accessible by any enumerator | Admin-only guard in place |
| N4 | `phone-validation/create` no district check | District check enforced |
| N5 | `react-native-encrypted-storage` may not be linked | `use_native_modules!` present in Podfile |

---

### ✅ NEWLY FIXED — Issues the audit expected to still be open, but are actually done

#### M5 — Centralized request validation with Zod *(Audit said: ❌ Not Fixed)*

**Verdict: ✅ Actually Fixed**

The audit said `zod` was in `package.json` but unused. This is no longer true.

`backend/src/schemas/request-schemas.ts` is a new 180-line schema file that defines typed, max-length-capped schemas for every free-text field:

```ts
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).optional().or(z.literal(''));

export const createSurveySchema = z.object({
  contactPerson:  optText(200),
  website:        optText(500),
  notes:          optText(2000),
  gstNumber:      optText(15),
  remarks:        optText(2000),
  ...
});
```

`.parse()` calls are wired into every controller (survey, phone-validation, sync, stakeholder, admin, media). The `error-handler.ts` now has a `ZodError` branch that returns clean `400` responses with field-level details.

**This issue is fully resolved.**

---

#### H7 — Per-account login lockout uses in-memory Map *(Audit said: ⚠️ Partial)*

**Verdict: ✅ Actually Fixed**

The audit said lockout was implemented with an in-memory `Map` (single-instance only). The submitted code has been upgraded to Redis:

```ts
// auth.service.ts
import { redisClient } from '../../config/redis';

async function checkLocked(loginId: string) {
  const locked = await redisClient.get(`login_lock:${loginId}`);
  if (locked) throw new UnauthorizedError('Account temporarily locked...');
}

async function recordFailure(loginId: string) {
  const key = `login_attempts:${loginId}`;
  const attempts = await redisClient.incr(key);
  await redisClient.expire(key, LOCKOUT_SECONDS);
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    await redisClient.set(`login_lock:${loginId}`, '1', { EX: LOCKOUT_SECONDS });
  }
}
```

`redis.ts` also wires up the client properly with error logging. The in-memory `Map` is gone.

**This issue is fully resolved.**

---

#### NEW-1 — `completeSurvey` counts soft-deleted media *(Audit said: 🔴 CRITICAL, new)*

**Verdict: ✅ Fixed**

The audit flagged that `completeSurvey` included soft-deleted media tombstones in its completion count. The fix is in place:

```ts
// survey.service.ts — completeSurvey
include: {
  media: { where: { deletedAt: null } },  // ✅ tombstones excluded
  ...
}
```

Both the completion check and the `getBySurvey` query correctly filter `deletedAt: null`.

**This issue is fully resolved.**

---

### ⚠️ STILL PARTIALLY FIXED

---

#### C8 — Admin panel JWT still stored in `localStorage` *(Audit said: ⚠️ Partial — CRITICAL)*

**Verdict: ⚠️ Still Partial — httpOnly cookie migration not done**

The CSP added to `index.ts` (via Helmet) is still the only mitigation. The token storage itself is unchanged:

```ts
// admin-panel/src/App.tsx — UNCHANGED
localStorage.setItem('admin_token', tokens.accessToken);
localStorage.setItem('admin_refresh', tokens.refreshToken);

// admin-panel/src/api.ts — UNCHANGED
const token = localStorage.getItem('admin_token');
```

**What still needs to be done:**

Move the admin session to an `httpOnly`, `Secure`, `SameSite=Strict` cookie.

**Backend (`auth.controller.ts`):**
```ts
res.cookie('admin_session', tokens.accessToken, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  maxAge: 15 * 60 * 1000,
});
res.json({ success: true, data: { enumerator } }); // no token in body
```

**Admin panel (`api.ts`):**
```ts
// Remove the Authorization interceptor entirely
const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // cookie sent automatically
});
```

Remove all `localStorage.setItem/getItem/removeItem` calls for `admin_token` and `admin_refresh` from `App.tsx` and `api.ts`.

**Additional CSP note:** The current `styleSrc: ["'self'", "'unsafe-inline'"]` directive leaves a CSS injection vector. Tighten to use a nonce or hash-based CSP once the token migration is done and the panel's inline styles are inventoried.

---

#### M7 — Mobile API base URL configuration incomplete *(Audit said: ⚠️ Partial — MEDIUM)*

**Verdict: ⚠️ Still Partial — `react-native-config` not installed**

The current `api.ts` has improved comments and startup protection, but `react-native-config` is still not in `mobile/package.json` and the `__ENV__` injection mechanism is not set up:

```ts
// mobile/src/services/api.ts — current state
// If you have react-native-config installed, replace the fallback line with:
//   import Config from 'react-native-config';
//   const API_BASE = Config.API_BASE_URL;
const API_BASE = (globalThis as any).__ENV__?.API_BASE_URL
  || (__DEV__ ? 'https://mahathithi-test.up.railway.app/api' : '');

if (!API_BASE) {
  throw new Error('[CONFIG] API_BASE_URL is not set...');
}
```

In a non-`__DEV__` production build, `__ENV__` is always `undefined` because the Metro plugin that injects it doesn't exist. This means production release builds throw a startup error.

**What still needs to be done:**

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

### ❌ STILL NOT FIXED

---

#### NEW-2 — `android/local.properties` with developer path committed *(Audit said: 🟡 MEDIUM, new)*

**Verdict: ❌ Not Fixed**

The file `mobile/android/local.properties` is no longer present in the ZIP. **However**, it was committed in a prior Git commit. The fix requires removing it from Git history, not just deleting the working copy.

The root `.gitignore` now contains `mobile/android/local.properties` and `mobile/android/.gitignore` also lists `local.properties`. This prevents future commits of the file. **But the file and its contents (`sdk.dir=C:\Users\fosec\...`) remain in Git history.**

**What still needs to be done:**

```bash
# Remove the file from all Git history
git filter-repo --path mobile/android/local.properties --invert-paths
# Or with BFG:
bfg --delete-files local.properties
git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push --force
```

The developer username `fosec` will remain accessible via `git log` until the history is rewritten. If this repository is or will be public, this is an OSINT risk.

---

#### NEW-3 — `console.log` dumps full PII payloads in production mobile builds *(Audit said: 🟠 HIGH, new)*

**Verdict: ❌ Not Fixed**

Both locations flagged by the audit are unchanged:

```ts
// mobile/src/store/slices/syncThunks.ts — line 268 — UNCHANGED
console.log(`📤 [Sync] Uploading text payload for survey ${localSurveyId}:`,
  JSON.stringify(surveyPayload, null, 2));

// mobile/src/screens/survey/SurveyFormScreen.tsx — line 771 — UNCHANGED
console.log('📤 [Survey Online] Uploading text payload:', JSON.stringify(surveyPayload, null, 2));
```

`babel.config.js` has no `transform-remove-console` plugin:

```js
// mobile/babel.config.js — current state
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // ← No production plugin to strip console.log
};
```

In a production Android build these logs are readable via `adb logcat`. They contain `contactPerson`, `mobileNumber`, `email`, `gstNumber`, `latitude`, `longitude`, and other PII for every survey submitted.

**What still needs to be done (choose one):**

Option A — `__DEV__` guard (minimal change):
```ts
if (__DEV__) {
  console.log(`📤 [Sync] Uploading text payload...`, JSON.stringify(surveyPayload, null, 2));
}
```

Option B — Babel plugin (strips all `console.*` from release builds):
```bash
npm install --save-dev babel-plugin-transform-remove-console
```
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

Option B is recommended — it protects against other verbose logs that may not have been audited.

---

#### L2 — No mobile TLS certificate pinning *(Audit said: ❌ Not Fixed — LOW)*

**Verdict: ❌ Not Fixed**

No TLS pinning library (`react-native-ssl-pinning`, `TrustKit`, `CertificatePinner`) is present in `mobile/package.json` or referenced anywhere in the mobile source tree.

This remains a lower priority (field devices on trusted MDM networks may not require it at initial launch), but it should be tracked as a pre-production hardening task given the sensitive PII being transmitted.

---

#### L4 — Backend logger has no PII redaction *(Audit said: ❌ Not Fixed — LOW)*

**Verdict: ❌ Not Fixed**

`backend/src/utils/logger.ts` is an unchanged Winston configuration with no redaction logic:

```ts
winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
  let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
  if (Object.keys(meta).length > 0) {
    log += ` ${JSON.stringify(meta)}`; // ← raw meta, no field filtering
  }
  return log;
})
```

`loginId` and operational details appear in log output as-is. This is not urgent while no log shipping (Datadog, CloudWatch, etc.) is configured, but should be addressed before any external log sink is wired up.

**What needs to be done:**

```ts
// Add a redact function
const SENSITIVE_KEYS = new Set(['loginId', 'phone', 'email', 'mobileNumber', 'gstNumber', 'password']);

function redactMeta(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) =>
      SENSITIVE_KEYS.has(k) ? [k, '[REDACTED]'] : [k, v]
    )
  );
}
```

---

### 📋 Carry-Over Items (Tracked from Prior Audits, Not New)

These were acknowledged in the audit as known-open backlog. Still unaddressed:

| Item | Status | Note |
|------|--------|------|
| Admin-only `/stakeholders/:id/relocate` endpoint | ❌ Missing | No admin API path to correct a mis-tagged district without direct DB access |
| **NEW-4:** `admin-panel` and `mobile` missing `npm audit` script | ✅ Fixed | All three `package.json` files now have `"audit": "npm audit --production"` |
| CI/CD GitHub Actions for automated auditing | ❌ Not Done | No `.github/` directory exists in the repo |

> **Note on NEW-4:** The audit said admin-panel and mobile were missing `npm audit` scripts. The code confirms all three packages now have the script. However, without a CI workflow to run it automatically on push/PR, it still has to be run manually. A `.github/workflows/audit.yml` file is still needed.

---

## Priority Action List

In order of impact and risk:

1. **NEW-3 (🟠 HIGH)** — Wrap `console.log(JSON.stringify(surveyPayload))` in `__DEV__` guards or add `babel-plugin-transform-remove-console`. PII is written to device system logs on every sync in production builds **today**.

2. **C8 (🔴 CRITICAL)** — Complete the admin session migration from `localStorage` to an `httpOnly` cookie. The CSP is a partial mitigation; the real fix is a ~20-line backend + frontend change.

3. **NEW-2 (🟡 MEDIUM)** — Rewrite Git history to remove `local.properties` (`git filter-repo` or BFG). The `.gitignore` fix stops future commits but doesn't remove the existing leak.

4. **M7 (🟡 MEDIUM)** — Install `react-native-config` and wire it into the mobile build. Production release builds currently crash on startup without it.

5. **CI/CD (🟢 LOW)** — Add `.github/workflows/audit.yml` to run `npm audit --production` across all three packages on push/PR. The scripts exist; they just need automation.

6. **L2 (🟢 LOW)** — Add TLS certificate pinning before the app goes to production on untrusted networks.

7. **L4 (🟢 LOW)** — Add PII redaction to the Winston logger before wiring up any external log sink.

8. **`/stakeholders/:id/relocate` (Backlog)** — Add an admin endpoint for correcting district assignments without direct DB access.