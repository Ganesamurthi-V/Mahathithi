# MahaAtithi — Offline Sync Bug Report & Fixes

**Branch:** `feature-sqlite`  
**Scope:** Why offline surveys and media never reach the Railway/Supabase backend

---

## Summary

There are **4 bugs** in the offline sync pipeline. Together they ensure that any survey saved while offline (or whose online upload fails mid-way) never actually reaches the server. The root causes span `syncThunks.ts`, `SurveyFormScreen.tsx`, and `database/index.ts`.

---

## Bug 1 — CRITICAL: Offline-queued surveys are silently dropped

**File:** `mobile/src/store/slices/syncThunks.ts`  
**Symptom:** A survey saved while offline shows as "pending upload" in Sync Center forever. Nothing ever reaches the server.

### What happens

When the device is offline (or upload fails), `SurveyFormScreen` queues the survey into `sync_queue`:

```ts
// SurveyFormScreen.tsx — both the offline and catch paths
await syncQueueDao.add('survey', stakeholderId, 'CREATE', surveyPayload);
```

When the device comes back online and `runAutoSync` fires, the sync queue pipeline runs — but it only handles **stakeholder updates**, not survey creates:

```ts
// syncThunks.ts — BEFORE FIX (broken)
for (const item of pendingSyncItems) {
  if (item.entity_type === 'stakeholder' && item.action === 'UPDATE') {
    // handles it ✅
  }
  // entity_type === 'survey' → falls through, nothing happens ❌
  await syncQueueDao.markCompleted(item.id); // still marks it done! double bug
}
```

The `syncQueueDao.markCompleted` call at the end always fires regardless, so the item gets marked `COMPLETED` even though it was never actually sent. **The survey is silently lost.**

### Fix

```ts
// syncThunks.ts — AFTER FIX
} else if (item.entity_type === 'survey' && item.action === 'CREATE') {
  const payload = JSON.parse(item.payload);
  await syncService.upload({
    surveys: [payload],
    phoneValidations: [],
    mediaMetadata: [],
  });
  // Mark local survey synced so the 1-by-1 pipeline can then handle its media
  await surveyDao.markSynced(payload.id);
}
```

---

## Bug 2 — CRITICAL: serverSurveyId is the local string on media-only sync runs

**File:** `mobile/src/store/slices/syncThunks.ts`  
**Symptom:** Media uploads in the background sync always fail with a 404 from the backend ("Survey not found").

### What happens

The auto-sync processes each `localSurveyId` in two logical passes:

- **Pass 1** (survey text unsynced): uploads survey text → `surveyDao.markSynced()` → then uploads media
- **Pass 2** (media still unsynced from a previous partial run): `surveyLocal` is `undefined` because `is_synced = 1`, so it's not in `unsyncedSurveys`

In Pass 2, the code tries to resolve `stakeholderId` to then call `surveyService.getByStakeholder()` and get the real server UUID. But:

```ts
// syncThunks.ts — BEFORE FIX (broken)
let stakeholderId =
  surveyLocal?.stakeholder_id ||            // undefined (survey already synced)
  (localSurveyId.startsWith('draft_') ? ... : null); // 'local_*' prefix → null
```

`stakeholderId` ends up `null`. Step B (server ID resolution) is gated on `if (stakeholderId)`, so it's skipped. `serverSurveyId` stays as `'local_1749012345_xyz'`. Media is uploaded with that as `surveyId`. The backend rejects it — no such survey exists.

### Fix

Store `stakeholder_id` in each media row when it's first saved to SQLite. Then in the auto-sync, fall back to the media row's `stakeholder_id` when `surveyLocal` is missing:

```ts
// syncThunks.ts — AFTER FIX
const mediaForThisSurvey = unsyncedMedia.filter((m: any) => m.survey_id === localSurveyId);
let stakeholderId =
  surveyLocal?.stakeholder_id ||
  mediaForThisSurvey[0]?.stakeholder_id ||     // ← NEW: from media row
  (localSurveyId.startsWith('draft_') ? localSurveyId.replace('draft_', '') : null);
```

This requires two supporting changes (see Bugs 3 and 4 fixes below).

---

## Bug 3 — CRITICAL: `stakeholder_id` not stored in media rows

**Files:** `mobile/src/database/index.ts`, `mobile/src/screens/survey/SurveyFormScreen.tsx`  
**Symptom:** Bug 2's fix can't work because the `media` table has no `stakeholder_id` column.

### Fix A — Add column to schema and migration

```ts
// database/index.ts — CREATE TABLE media
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL,
  stakeholder_id TEXT,         -- NEW column
  ...
```

```ts
// database/index.ts — runMigrations(), existing installs
try {
  await database.executeSql('ALTER TABLE media ADD COLUMN stakeholder_id TEXT;');
} catch (e) { /* ignore if already exists */ }
```

### Fix B — Update `mediaDao.save` to accept and store it

```ts
// database/index.ts — mediaDao.save
await database.executeSql(
  `INSERT OR REPLACE INTO media
    (id, survey_id, stakeholder_id, type, photo_category, ...)
   VALUES (?,?,?,?,?,...)`,
  [id, media.surveyId, media.stakeholderId || null, ...]
);
```

### Fix C — Pass `stakeholderId` in every `mediaDao.save` call

```ts
// SurveyFormScreen.tsx — saveMediaToDb()
await mediaDao.save({
  surveyId: newSurveyId,
  stakeholderId,   // ← NEW
  type: 'PHOTO',
  ...
});
```

---

## Bug 4 — MODERATE: Media rows never marked synced after successful online upload

**File:** `mobile/src/screens/survey/SurveyFormScreen.tsx`  
**Symptom:** After a survey is successfully uploaded online, the background auto-sync still tries to re-upload all its photos/videos on every subsequent run. These re-uploads fail (Bug 2) and pollute the "Failed Uploads" counter in Sync Center.

### What happens

After the online upload succeeds:

```ts
await surveyService.complete(realSurveyId);
await surveyDao.markSynced(surveyId);   // ✅ survey marked synced
// ❌ mediaDao.markSynced() never called for any photo or video
```

All media rows remain `is_synced = 0`. On the next `runAutoSync`, `mediaDao.getUnsynced()` returns them all, and the auto-sync tries to upload them again with (now) a stale `localSurveyId`.

### Fix

```ts
// SurveyFormScreen.tsx — after successful complete()
await surveyDao.markSynced(surveyId);
// BUG 4 FIX: mark all media as synced
const allSavedMedia = await mediaDao.getBySurveyLocal(surveyId);
for (const m of allSavedMedia) {
  await mediaDao.markSynced(m.id);
}
```

This also requires a new helper on `mediaDao`:

```ts
// database/index.ts — mediaDao
async getBySurveyLocal(surveyId: string): Promise<any[]> {
  const db = await getDB();
  const [results] = await db.executeSql(
    `SELECT * FROM media WHERE survey_id = ?`, [surveyId]
  );
  const rows = [];
  for (let i = 0; i < results.rows.length; i++) rows.push(results.rows.item(i));
  return rows;
},
```

---

## Files Changed

| File | Change |
|---|---|
| `mobile/src/store/slices/syncThunks.ts` | Bug 1: added `survey/CREATE` handler in sync queue loop; Bug 2: read `stakeholder_id` from media row as fallback |
| `mobile/src/database/index.ts` | Bug 3: added `stakeholder_id` column to `media` table + ALTER TABLE migration + updated `mediaDao.save` signature + added `mediaDao.getBySurveyLocal` |
| `mobile/src/screens/survey/SurveyFormScreen.tsx` | Bug 3: pass `stakeholderId` to `saveMediaToDb`; Bug 4: call `mediaDao.markSynced` for all media after successful online upload |

---

## Complete Offline-to-Online Flow After Fixes

```
Device offline, enumerator submits survey
  ↓
surveyDao.save()           — survey text → SQLite (is_synced=0)
saveMediaToDb()            — photos+video → SQLite (is_synced=0, stakeholder_id stored)
syncQueueDao.add('survey', 'CREATE', payload)   — queued for later

Device comes back online, runAutoSync fires
  ↓
[Sync Queue Pipeline]
  item.entity_type === 'survey' && action === 'CREATE'  ← BUG 1 FIXED
    → syncService.upload({ surveys: [payload] })        — survey text → Railway
    → surveyDao.markSynced(payload.id)                 — survey is_synced=1
    → syncQueueDao.markCompleted(item.id)

[1-by-1 Media Pipeline]
  surveyLocal = undefined (is_synced=1, already done)
  stakeholderId = mediaForThisSurvey[0].stakeholder_id  ← BUG 2+3 FIXED
  surveyService.getByStakeholder(stakeholderId)          — get real server UUID
  → media uploaded with correct serverSurveyId
  → mediaDao.markSynced(media.id)                       — is_synced=1

[Complete]
  surveyService.complete(serverSurveyId)
  stakeholder locked on server, removed from local SQLite
  Sync Center shows 0 pending
```

---

## Quick Verification Checklist

After applying the patches, test this sequence:

1. **Airplane mode ON** → submit a full survey (photos + video) → confirm "Saved Offline" alert
2. **Airplane mode OFF** → open Sync Center → tap "Sync Now" → confirm pending count goes to 0 with no failures
3. **Check Railway logs** → confirm one `POST /api/sync/upload`, multiple `POST /api/media/upload`, and one `POST /api/surveys/:id/complete`
4. **Check admin panel** → the stakeholder should now show as CLOSED with gallery populated
5. **Repeat Sync Now** → confirm nothing re-uploads (media `is_synced=1`)

