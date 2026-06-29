# `survey.service.ts` — Full Bug Report
**Codebase:** `Mahathithi-feature-sqlite.zip`  
**Files inspected:** `survey.service.ts`, `survey.controller.ts`, `survey.routes.ts`, `sync.service.ts`, `stakeholder.service.ts`, `request-schemas.ts`, `prisma/schema.prisma`  
**Date:** 2026-06-29

---

## Summary

| # | Severity | Status | Title |
|---|----------|--------|-------|
| B1 | 🔴 CRITICAL | ✅ Fixed | `completeSurvey` has no district isolation — any enumerator can complete any survey |
| B2 | 🟠 HIGH | ✅ Fixed | `getByStakeholderId` returns any enumerator's survey, not the caller's |
| B3 | 🟠 HIGH | ✅ Fixed | GPS `0,0` passes the completion check — falsy check on numbers |
| B4 | 🟠 HIGH | ✅ Fixed | `sync.service.ts` drops `contactPerson2`, `mobileNumber2`, `email2` on every sync |
| B5 | 🟡 MEDIUM | ✅ Fixed | `stakeholder.getById` includes soft-deleted media in detail view |
| B6 | 🟡 MEDIUM | ✅ Fixed | `ValidationError` imported but never thrown — `completeSurvey` silently accepts incomplete surveys instead of erroring |
| B7 | 🟡 MEDIUM | ✅ Fixed | Dead import: `StakeholderService` instantiated but never used |
| B8 | 🟢 LOW | ✅ Fixed | Method name typo: `getMysSurveys` (double `s`) in controller and routes |
| B9 | 🟢 LOW | ✅ Fixed | `getByStakeholderId` returns `null` (not a 404) when no survey exists for a stakeholder |
| X1 | 🟠 HIGH | ✅ Fixed | `sync.service.ts` phone validation `create` has no district check |
| X2 | 🟠 HIGH | ✅ Fixed | `stakeholder.getById` exposes surveys/phone validations of other enumerators |

---

## B1 — `completeSurvey` has no district isolation 🔴 CRITICAL

**File:** `survey.service.ts` → `completeSurvey(surveyId, enumeratorId)`  
**Also:** `survey.controller.ts` → `complete()`, `survey.routes.ts`

### What the code does

```ts
// survey.controller.ts
async complete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const result = await surveyService.completeSurvey(
    req.params.id,
    req.enumerator!.id   // ← only enumeratorId passed, no districts, no isAdmin
  );
}

// survey.service.ts
async completeSurvey(surveyId: string, enumeratorId: string) {
  const survey = await prisma.survey.findUnique({ where: { id: surveyId }, ... });

  if (survey.enumeratorId !== enumeratorId) {
    throw new ConflictError('You can only complete your own surveys');
  }
  // No assertStakeholderAccess() call — district is never checked
  ...
}
```

The ownership check (`survey.enumeratorId !== enumeratorId`) only stops a caller from completing **another person's survey**. It does not stop an enumerator from targeting a survey that belongs to a stakeholder outside their assigned district, as long as they somehow obtained that survey's UUID. Survey IDs are UUIDs and not guessable by brute force, but they can be leaked via audit logs, error messages, or an IDOR in another endpoint. Compared to `createOrUpdate` and `getByStakeholderId`, which both call `assertStakeholderAccess`, the complete path is an unguarded outlier.

### Why this matters

A survey being "completed" is the highest-privilege write operation in the entire system: it sets `isCompleted: true`, sets the stakeholder `status: 'CLOSED'`, writes `lockedById`, and creates an audit log — all in a single atomic transaction. All of those effects bypass the district restriction that every other endpoint enforces.

### Fix

Pass `districts` and `isAdmin` from the controller and call `assertStakeholderAccess` inside `completeSurvey` before any validation.

```ts
// survey.controller.ts
async complete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const result = await surveyService.completeSurvey(
    req.params.id,
    req.enumerator!.id,
    req.enumerator!.districts,  // ADD
    req.enumerator!.isAdmin     // ADD
  );
  res.json({ success: true, data: result });
}

// survey.service.ts — updated signature
async completeSurvey(
  surveyId: string,
  enumeratorId: string,
  enumeratorDistricts: string[],   // ADD
  isAdmin: boolean                 // ADD
) {
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    include: {
      media: { where: { deletedAt: null } },
      stakeholder: {
        include: { phoneValidations: { where: { enumeratorId } } },
      },
    },
  });

  if (!survey) throw new NotFoundError('Survey');

  // ADD — district check must come before the ownership check
  assertStakeholderAccess(survey.stakeholder, enumeratorDistricts, isAdmin);

  if (survey.enumeratorId !== enumeratorId) {
    throw new ConflictError('You can only complete your own surveys');
  }
  ...
}
```

---

## B2 — `getByStakeholderId` returns the wrong enumerator's survey 🟠 HIGH

**File:** `survey.service.ts` → `getByStakeholderId()`

### What the code does

```ts
const survey = await prisma.survey.findFirst({
  where: { stakeholderId },   // ← no enumeratorId filter
  ...
});
```

`findFirst` with only `stakeholderId` returns the **first** survey Prisma finds for that stakeholder, ordered by default (insertion order). If multiple enumerators have created surveys for the same stakeholder, this endpoint returns another enumerator's survey data to the caller.

### Concrete impact

Enumerator A starts a survey for stakeholder X. Later, Enumerator B (in the same district) calls `GET /surveys/stakeholder/:id`. They get Enumerator A's draft — including A's contact person, notes, GPS coordinates, and all personally collected PII. Enumerator B's own data (if any) is silently hidden.

### Fix

Scope the query to the calling enumerator's `id`:

```ts
const survey = await prisma.survey.findFirst({
  where: {
    stakeholderId,
    enumeratorId: callerEnumeratorId,  // ADD — must be threaded from the controller
  },
  include: {
    media: { where: { deletedAt: null } },
    stakeholder: { select: { companyNameStandardized: true, district: true, status: true } },
  },
});
```

The `enumeratorId` is already available in the controller (`req.enumerator!.id`) but was never passed to the service method. Add it to the service signature:

```ts
// service signature
async getByStakeholderId(
  stakeholderId: string,
  enumeratorId: string,         // ADD
  enumeratorDistricts: string[],
  isAdmin: boolean
)

// controller
const survey = await surveyService.getByStakeholderId(
  req.params.stakeholderId,
  req.enumerator!.id,           // ADD
  req.enumerator!.districts,
  req.enumerator!.isAdmin
);
```

---

## B3 — GPS `0,0` silently passes the completion check 🟠 HIGH

**File:** `survey.service.ts` → `completeSurvey()`

### What the code does

```ts
// 3. GPS
if (!survey.latitude || !survey.longitude) {
  validationErrors.push('GPS coordinates are required');
}
```

`!survey.latitude` is `true` when `latitude` is `0`, `null`, `undefined`, `false`, or `NaN`. In JavaScript, `!0 === true`. This means a survey recorded at the equator/prime meridian (lat=0, lon=0) will fail GPS validation even though GPS was genuinely captured. More critically for this project, if a bug in the mobile app ever submits `latitude: 0` as a default/reset value, the survey will also wrongly fail.

The inverse problem is less likely but also present: if `latitude` is stored as the string `"0"`, `!survey.latitude` is `false` (non-empty string is truthy) and the check passes incorrectly.

### Fix

Use explicit `null`/`undefined` checks, not truthiness:

```ts
// Correct — handles 0 as a valid coordinate
if (survey.latitude == null || survey.longitude == null) {
  validationErrors.push('GPS coordinates are required');
}
```

---

## B4 — `sync.service.ts` silently drops secondary contact fields on every sync 🟠 HIGH

**File:** `sync.service.ts` → `processUpload()` — the survey upsert block

### What the code does

The `createSurveySchema` in `request-schemas.ts` includes three secondary contact fields:

```ts
// request-schemas.ts — correct
contactPerson2: optText(200),
mobileNumber2: optText(20),
email2: optText(200),
```

The `Survey` Prisma model also has these columns. The online `survey.service.ts` `createOrUpdate` correctly passes them. But the sync path (`sync.service.ts`) omits all three in both the `update` and `create` blocks of the survey upsert:

```ts
// sync.service.ts — update block (missing 3 fields)
update: {
  contactPerson: surveyData.contactPerson,
  designation: surveyData.designation,
  mobileNumber: surveyData.mobileNumber,
  email: surveyData.email,
  // ← contactPerson2 MISSING
  // ← mobileNumber2 MISSING
  // ← email2 MISSING
  website: surveyData.website,
  ...
},

// sync.service.ts — create block (also missing 3 fields)
create: {
  ...
  email: surveyData.email,
  // ← contactPerson2 MISSING
  // ← mobileNumber2 MISSING
  // ← email2 MISSING
  website: surveyData.website,
  ...
},
```

The schema (`syncSurveyItemSchema`) correctly validates these fields from the mobile payload, but then the service ignores the validated values and never writes them to the database.

### Impact

Field enumerators fill in secondary contact details offline. When the mobile app syncs, those three fields are silently lost. The server-side data will permanently differ from what the enumerator collected. This is a silent data loss bug — no error is returned.

### Fix

Add the three fields to both the `update` and `create` blocks:

```ts
// sync.service.ts — both blocks
update: {
  contactPerson: surveyData.contactPerson,
  designation: surveyData.designation,
  mobileNumber: surveyData.mobileNumber,
  email: surveyData.email,
  contactPerson2: surveyData.contactPerson2,   // ADD
  mobileNumber2: surveyData.mobileNumber2,     // ADD
  email2: surveyData.email2,                   // ADD
  website: surveyData.website,
  ...
},
create: {
  ...
  email: surveyData.email,
  contactPerson2: surveyData.contactPerson2,   // ADD
  mobileNumber2: surveyData.mobileNumber2,     // ADD
  email2: surveyData.email2,                   // ADD
  website: surveyData.website,
  ...
},
```

---

## B5 — `stakeholder.getById` includes soft-deleted media 🟡 MEDIUM

**File:** `stakeholder.service.ts` → `getById()`

### What the code does

```ts
// stakeholder.service.ts
surveys: {
  include: {
    media: true,   // ← no deletedAt: null filter
  },
},
```

Every other media query in the codebase filters tombstoned records:

- `survey.service.ts` → `getByStakeholderId`: `media: { where: { deletedAt: null } }` ✅
- `survey.service.ts` → `completeSurvey`: `media: { where: { deletedAt: null } }` ✅  
- `survey.service.ts` → `getByEnumerator`: `media: { where: { deletedAt: null } }` ✅
- `media.service.ts` → `getBySurvey`: `where: { surveyId, deletedAt: null }` ✅
- `stakeholder.service.ts` → `getById`: **no filter** ❌

The stakeholder detail view (used by the admin panel and the mobile stakeholder detail screen) exposes deleted media records including their `filePath` (S3 key) and `fileUrl` (presigned URL). When the S3 hard-delete succeeded and the DB row was cleaned up, the record is gone. But when S3 deletion failed and the tombstone was left in place (the intended retry case from the L6 fix), the tombstone is shown to clients.

### Fix

```ts
// stakeholder.service.ts — getById()
surveys: {
  include: {
    media: {
      where: { deletedAt: null },   // ADD
    },
  },
},
```

---

## B6 — `ValidationError` imported but never thrown; `completeSurvey` silently accepts incomplete surveys via wrong return path 🟡 MEDIUM

**File:** `survey.service.ts`

### What the code does

```ts
// Line 2 — imported but unused as a thrown error class
import { NotFoundError, ValidationError, ConflictError } from '../../utils/errors';
```

`ValidationError` is imported but never called with `throw`. Instead, `completeSurvey` collects errors in a plain `string[]` and, if there are failures, returns a `200 OK` with `status: 'OPEN'` and `missingRequirements`:

```ts
return {
  status: 'OPEN',
  message: 'Survey submitted but not complete. Some requirements are not met.',
  missingRequirements: validationErrors,  // array of strings, 200 OK
};
```

This design means:
1. The HTTP response code for a failed completion is `200`, not `422` or `400`. Client code that checks only the status code will treat an incomplete survey as a success.
2. The `isDraft` flag is set to `false` even for incomplete surveys (the "partial submission" branch). A survey with `isDraft: false` and `isCompleted: false` is an ambiguous state — the survey left the draft state but is not done.
3. `ValidationError` is dead import weight and should either be used or removed.

### Fix

Two options depending on design intent:

**Option A — Return 422 for incomplete surveys (recommended):**
```ts
// survey.service.ts — in completeSurvey, after building validationErrors
if (validationErrors.length > 0) {
  throw new ValidationError('Survey is incomplete', validationErrors);
  // ValidationError extends AppError with statusCode 400 — error-handler returns 400
}

// Then proceed with the CLOSED + LOCK transaction
```

Remove the `isDraft: false` partial-update transaction entirely — a survey should only leave draft state when it succeeds.

**Option B — Keep soft-failure (current design intent) but fix the status code:**
If the intent really is to accept partial surveys and inform the client which requirements are missing, the controller should return `422`:

```ts
// survey.controller.ts — complete()
const result = await surveyService.completeSurvey(...);
const httpStatus = result.status === 'CLOSED' ? 200 : 422;
res.status(httpStatus).json({ success: result.status === 'CLOSED', data: result });
```

---

## B7 — Dead import: `StakeholderService` instantiated but never used 🟡 MEDIUM

**File:** `survey.service.ts` lines 5–7

### What the code does

```ts
import { StakeholderService } from '../stakeholder/stakeholder.service';

const stakeholderService = new StakeholderService();
```

`stakeholderService` is never referenced anywhere else in `survey.service.ts`. It is likely a leftover from a refactor where stakeholder locking was moved out of the survey service.

### Why this matters

Beyond code smell, this creates a circular-dependency risk. `StakeholderService` imports from Prisma and potentially other modules. If `StakeholderService` is ever changed to import from `SurveyService` (plausible, since they're coupled), this line will create a circular module dependency that crashes the Node.js process at startup with a cryptic `undefined` error on the imported class.

### Fix

Remove both lines:

```ts
// DELETE these two lines from survey.service.ts
import { StakeholderService } from '../stakeholder/stakeholder.service';
const stakeholderService = new StakeholderService();
```

---

## B8 — Method name typo `getMysSurveys` (double `s`) 🟢 LOW

**Files:** `survey.controller.ts` line 54, `survey.routes.ts` line 11

### What the code does

```ts
// survey.controller.ts
async getMysSurveys(req, res, next) { ... }  // ← "Myss" not "My"

// survey.routes.ts
router.get('/mine', controller.getMysSurveys);  // ← matches the typo, so it works
```

Both the controller and the route use the same typo, so the endpoint functions. The bug is a readability and refactoring hazard: any developer who tries to call `controller.getMySurveys` (the correct spelling) will get `undefined` and a silent 500, or TypeScript will catch it at compile time with `Property 'getMySurveys' does not exist`.

### Fix

```ts
// survey.controller.ts
async getMySurveys(req, res, next) { ... }   // fix typo

// survey.routes.ts
router.get('/mine', controller.getMySurveys); // fix reference
```

---

## B9 — `getByStakeholderId` returns `null` instead of 404 when no survey exists 🟢 LOW

**File:** `survey.service.ts` → `getByStakeholderId()`, line 144

### What the code does

```ts
const survey = await prisma.survey.findFirst({ where: { stakeholderId } });
return survey;  // returns null if no survey found
```

`findFirst` returns `null` when no row matches. The service propagates that `null` directly to the controller, which wraps it in a `200 OK` response:

```json
{ "success": true, "data": null }
```

### Why this is a problem

Client code that expects `data` to be a survey object (not null) will crash with a TypeError on `.contactPerson` or similar. The correct response for "no survey for this stakeholder" is either a `404` or an explicit empty state — not a 200 with `null`.

### Fix

```ts
// survey.service.ts — getByStakeholderId
const survey = await prisma.survey.findFirst({ where: { stakeholderId } });

if (!survey) {
  // Return null explicitly is OK only if the controller handles it.
  // Better: throw a NotFoundError so the response is a clean 404.
  return null;   // OR: throw new NotFoundError('Survey');
}

return survey;
```

The controller should handle the null case:

```ts
// survey.controller.ts — getByStakeholder
const survey = await surveyService.getByStakeholderId(...);
if (!survey) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No survey found for this stakeholder' } });
  return;
}
res.json({ success: true, data: survey });
```

---

## Cross-File Issues Found During This Review

These bugs are in files adjacent to `survey.service.ts` and were found while tracing the survey data flow.

### X1 — `sync.service.ts`: phone validation `create` has no district check 🟠 HIGH

**File:** `sync.service.ts` → `processUpload()` — phone validation loop

```ts
// sync.service.ts — phone validation block
for (const pvData of (payload.phoneValidations || [])) {
  try {
    await prisma.phoneValidation.create({ data: { stakeholderId: pvData.stakeholderId, ... } });
    // ← no district check before writing!
  }
}
```

The survey loop (just above it) has a correct district check. The phone validation loop does not. A mobile client can include a phone validation for a stakeholder in a completely different district and it will be written without any access control. This is a variant of the original N4 finding (which fixed the online API endpoint) but was not carried over to the sync batch path.

**Fix:**

```ts
for (const pvData of (payload.phoneValidations || [])) {
  try {
    // ADD: same district check as the survey loop above
    const stakeholder = await prisma.stakeholder.findUnique({
      where: { id: pvData.stakeholderId },
      select: { district: true },
    });
    if (!stakeholder) {
      results.phoneValidations.failed++;
      results.phoneValidations.errors.push(`Stakeholder ${pvData.stakeholderId}: not found`);
      continue;
    }
    if (!isAdmin) {
      const inDistrict = districts.some(d => d.toUpperCase() === stakeholder.district?.toUpperCase());
      if (!inDistrict) {
        results.phoneValidations.failed++;
        results.phoneValidations.errors.push(`Stakeholder ${pvData.stakeholderId}: outside assigned districts`);
        continue;
      }
    }
    await prisma.phoneValidation.create({ ... });
```

### X2 — `stakeholder.service.ts`: `getById` exposes surveys of other enumerators 🟠 HIGH

**File:** `stakeholder.service.ts` → `getById()`

```ts
// stakeholder.service.ts
surveys: {
  include: {
    media: true,
  },
},
```

The `getById` endpoint returns **all surveys** for a stakeholder, from all enumerators, with no per-enumerator scoping. If Enumerator A and Enumerator B both have surveys for the same stakeholder (which is possible before the stakeholder is locked), Enumerator A calling `GET /stakeholders/:id` sees Enumerator B's full survey data including contact person, GPS, notes, and all media.

**Fix:**

```ts
// stakeholder.service.ts — getById
surveys: {
  where: { enumeratorId },   // ADD — scope to the requesting enumerator
  include: {
    media: { where: { deletedAt: null } },
  },
},
```

The `enumeratorId` needs to be threaded in from the controller. The controller already has `req.enumerator!.id` available.

---

## Recommended Fix Order

| Priority | Bug | One-line reason |
|----------|-----|-----------------|
| 1st | **B1** | Highest-privilege write with no district check |
| 2nd | **X1** | Phone validation sync writes bypass district entirely |
| 3rd | **B4** | Silent data loss on every offline sync |
| 4th | **B2** / **X2** | Cross-enumerator data leak on survey/stakeholder reads |
| 5th | **B3** | GPS check accepts 0,0 (valid equator location) as missing |
| 6th | **B5** | Tombstoned media shown in stakeholder detail |
| 7th | **B6** | Complete path returns 200 for failed completions; ambiguous state |
| 8th | **B7** | Dead import risks circular dependency |
| 9th | **B8** | Typo will cause silent runtime errors if method is called correctly |
| 10th | **B9** | `null` response for missing survey instead of `404` |