# MahaAtithi — Mid-Sync Offline Drop Analysis

**Question:** What happens if the user goes offline again in the middle of `runAutoSync`?

---

## How the sync pipeline is structured

`runAutoSync` runs as one long async function with a single connectivity check **at the very start**. After that it fires HTTP calls sequentially with no further network awareness. If connection drops mid-run, axios throws a network error on the next call, and the code reacts based on whichever try/catch wraps that call.

```
runAutoSync():
  1. [GUARD]  NetInfo.fetch() — one-time check, then forgotten
  2. [NEW]    Stranded completion retry (is_synced=1, is_completed=0)
  3. [QUEUE]  syncQueueDao pipeline (survey CREATE, stakeholder UPDATE)
  4. [LOOP]   Per-survey 1-by-1 pipeline:
       Step A — POST /sync/upload        (survey text)
       Step B — GET  /surveys/stakeholder/:id  (resolve server UUID)
       Step C — POST /media/upload       (one per photo/video)
       Step D — POST /surveys/:id/complete
  5. [PULL]   GET /sync/changes
  6. [LOCAL]  Update last_sync_time in SQLite
```

When connection drops mid-run, the NetInfo listener in `AppNavigator` will detect the reconnect and fire `runAutoSync` again automatically. So recovery is eventual — **unless** a scenario leaves data in a state the next sync can't detect.

---

## Scenario A — Drops during Sync Queue pipeline

**What happens:**  
axios throws → `catch(err)` → `syncQueueDao.markFailed(item.id)` → loop continues (all remaining items also fail) → outer catch → `dispatch(syncFailed())` → `isSyncing = false`.

**Outcome:** ✅ Safe. All queue items remain retryable. `retry_count` is incremented but there's no retry limit, so they all get attempted on the next sync run.

---

## Scenario B — Drops during Step A (survey text upload)

**What happens:**  
axios throws on `syncService.upload()` → propagates to the per-survey `catch(surveyErr)` → loop moves to next survey. The local survey row stays `is_synced = 0`.

**Outcome:** ✅ Safe. Survey retried cleanly on next sync.

---

## Scenario C — Drops during Step B (server UUID resolution)

**What happens:**  
The inner `try/catch` around Step B silently swallows the error (`catch { /* ignore if not found */ }`). `serverSurveyId` stays as the local string (`local_xxx`). Step C then tries to upload media with that wrong ID, also fails (still offline), throws, caught by the per-survey catch. Survey stays pending.

**Outcome:** ✅ Safe in practice — media upload fails anyway. But the silent swallow is misleading in logs. Worth noting: if Step B threw but Step C somehow didn't (e.g., if connection came back between B and C), media would be uploaded with the wrong survey ID and rejected by the server. This is an unlikely race but a real code smell.

---

## Scenario D — Drops mid-media-upload (e.g. photo 3 of 5)

**What happens:**  
- Photos 1–2: uploaded + `mediaDao.markSynced()` called → `is_synced = 1`
- Photo 3: axios throws → `throw new Error('Media failed: ...')` → caught by per-survey catch
- Photos 4–5: never attempted this run
- `complete()` never called — stakeholder stays `OPEN` on server
- Next sync: photos 1–2 are `is_synced=1`, not retried. Photos 3–5 are `is_synced=0`, retried correctly.

**Outcome:** ✅ Partial retry behavior is correct. Photos 3–5 will upload next sync, then `complete()` will fire.

**Dependency:** This only works correctly with the Bug 3 fix applied (storing `stakeholder_id` in media rows). Without it, the next sync can't resolve `serverSurveyId` for the remaining photos and they stay stuck forever.

---

## Scenario E — Drops during Step D (`complete()`) ⚠️ CRITICAL BUG

**What happens:**  
- Step A: survey text uploaded → `surveyDao.markSynced()` → `is_synced = 1`  
- Step C: all photos/videos uploaded → `mediaDao.markSynced()` → all `is_synced = 1`  
- Step D: `surveyService.complete()` throws (network dropped)  
- Per-survey catch handles it silently  

**State after the drop:**

| Layer | State |
|---|---|
| Server — survey | Exists, all media attached, `isDraft = true` (not closed) |
| Server — stakeholder | Still `OPEN`, not locked |
| Local — survey | `is_synced = 1`, `is_completed = 0` |
| Local — media | All `is_synced = 1` |

**What happens on the next `runAutoSync`:**
```
unsyncedSurveys = surveyDao.getUnsynced()  → []  (is_synced=1)
unsyncedMedia   = mediaDao.getUnsynced()   → []  (all is_synced=1)
surveyIdsToProcess = empty set
→ The entire 1-by-1 pipeline is skipped
→ complete() is NEVER retried
→ Stakeholder stays OPEN on the server permanently
→ Survey data and photos exist on server but the survey is never "done"
→ Admin panel shows the stakeholder as pending, it can never be closed
```

This is the most dangerous scenario because the data is actually complete on the server — it just never got finalized. An admin could fix it manually, but the enumerator has no way to know anything went wrong (the app shows no pending items).

### Fix

**Two changes required:**

**1. `database/index.ts` — add `markCompleted` and `getPendingCompletion` to `surveyDao`:**

```ts
async markCompleted(id: string): Promise<void> {
  const database = await getDB();
  await database.executeSql('UPDATE surveys SET is_completed = 1 WHERE id = ?', [id]);
},

async getPendingCompletion(): Promise<any[]> {
  const database = await getDB();
  const [results] = await database.executeSql(
    'SELECT * FROM surveys WHERE is_synced = 1 AND is_completed = 0'
  );
  const rows = [];
  for (let i = 0; i < results.rows.length; i++) rows.push(results.rows.item(i));
  return rows;
},
```

**2. `syncThunks.ts` — call `markCompleted` after successful `complete()`, and add a stranded-completion retry pipeline at the top of `runAutoSync`:**

```ts
// After surveyService.complete() succeeds in Step D:
await surveyService.complete(serverSurveyId);
await surveyDao.markCompleted(localSurveyId);  // ← NEW

// New pipeline added at the start of runAutoSync (before the Sync Queue):
const pendingCompletions = await surveyDao.getPendingCompletion();
for (const survey of pendingCompletions) {
  try {
    let serverSurveyId = survey.id;
    if (survey.stakeholder_id) {
      try {
        const svRes = await surveyService.getByStakeholder(survey.stakeholder_id);
        if (svRes.data?.data?.id) serverSurveyId = svRes.data.data.id;
      } catch { }
    }
    await surveyService.complete(serverSurveyId);
    await surveyDao.markCompleted(survey.id);
    if (survey.stakeholder_id) {
      await stakeholderDao.removeLockedStakeholders([survey.stakeholder_id]);
    }
  } catch (err: any) {
    // Will retry on next sync — survey remains is_completed=0
  }
}
```

The `is_completed` column already exists in the SQLite `surveys` table — no migration needed.

---

## Recovery mechanism

`AppNavigator` has:
```ts
NetInfo.addEventListener((state) => {
  if (state.isConnected) {
    dispatch(runAutoSync());
  }
});
```

So when connection drops and returns, `runAutoSync` is automatically re-triggered. The guard `if (state.sync.isSyncing) return` ensures concurrent runs don't pile up. As long as the previous run properly dispatched `syncComplete` or `syncFailed` (setting `isSyncing = false`), recovery is automatic for all scenarios — **except Scenario E**, which leaves no detectable pending work.

---

## Summary table

| Scenario | Drop point | Data safe? | Auto-recovers? | Fix needed? |
|---|---|---|---|---|
| A | Sync queue pipeline | ✅ Yes | ✅ Yes (next sync) | No |
| B | Survey text upload (Step A) | ✅ Yes | ✅ Yes | No |
| C | Server UUID resolution (Step B) | ✅ Yes | ✅ Yes | No |
| D | Mid-media-upload (Step C) | ✅ Partial retry works | ✅ Yes | Requires Bug 3 fix |
| **E** | **complete() (Step D)** | **⚠️ Data on server, not closed** | **❌ Never retried** | **Yes — fixed above** |