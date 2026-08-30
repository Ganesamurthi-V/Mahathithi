import { createAsyncThunk } from '@reduxjs/toolkit';
import NetInfo from '@react-native-community/netinfo';
import { RootState } from '../index';
import {
  startSync, syncComplete, syncFailed, updateSyncProgress,
  setPendingCount, setFailedCount, setDeadLetterCount,
  startInitialSync, updateInitialSyncProgress, initialSyncComplete, initialSyncFailed
} from './syncSlice';
import { syncService, mediaService, surveyService, stakeholderService, facilityService } from '../../services/api';
import { announceLocalDataChange } from '../../services/realtime';
import { surveyDao, syncQueueDao, stakeholderDao, appStateDao, mediaDao, facilityDao } from '../../database';

// Page size for the paginated stakeholder download.
// 5000 rows × ~1.5 KB average JSON per row ≈ 7 MB per page — comfortably
// within what a budget Android device can hold in memory at once.
const INITIAL_SYNC_PAGE_SIZE = 10000;

export const runInitialSync = createAsyncThunk(
  'sync/runInitialSync',
  async (_, { dispatch, getState }) => {
    const state = getState() as RootState;
    if (state.sync.isInitialSyncing) return;

    // Check if initial sync is already done
    const isDone = await appStateDao.get('initial_sync_done');
    if (isDone === 'true') {
      return;
    }

    try {
      dispatch(startInitialSync());

      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        throw new Error('No internet connection. Please connect to the internet to perform the initial setup.');
      }

      // ── Step 1: Download Stakeholders (paginated) ──────────────────────────
      // The old approach fetched ALL stakeholders in one HTTP call. With 1 L+
      // records that single request:
      //   • hits the 30-second axios timeout before the transfer completes
      //   • may OOM the device trying to parse one giant JSON body in memory
      //   • gives the user zero feedback for minutes, then fails with no progress saved
      //
      // The new approach:
      //   1. Calls GET /stakeholders/assigned/paged?after=<cursor>&page_size=2000
      //   2. Upserts each page into SQLite immediately — memory footprint is
      //      always bounded to one page at a time
      //   3. Advances the cursor via `nextCursor` from each response
      //   4. Stops when `nextCursor` is null (server signals no more pages)
      //
      // Progress is shown as 10 % → 55 % proportional to pages downloaded.
      // Because we don't know the total upfront we use an asymptotic approach:
      // each page contributes half the remaining gap between current and 55 %.
      // This keeps the bar moving continuously without ever hitting 55 % before
      // we're actually done downloading.
      console.log('🔄 [Initial Sync] Fetching stakeholders from backend (paginated)...');
      dispatch(updateInitialSyncProgress({ progress: 10, message: 'Downloading Stakeholders...' }));

      let cursor = 0;
      let pageNumber = 0;
      let totalDownloaded = 0;
      let downloadProgress = 10; // starts at 10, approaches 55 asymptotically

      while (true) {
        pageNumber += 1;
        console.log(`🔄 [Initial Sync] Requesting page ${pageNumber} (after cursor=${cursor})...`);

        const pageRes = await stakeholderService.getAssignedPaged(cursor, INITIAL_SYNC_PAGE_SIZE);
        const pageData = pageRes.data?.data;
        const pageRows: any[] = pageData?.stakeholders ?? [];
        const nextCursor: number | null = pageData?.nextCursor ?? null;

        console.log(`✅ [Initial Sync] Page ${pageNumber}: received ${pageRows.length} stakeholders (nextCursor=${nextCursor}).`);

        if (pageRows.length > 0) {
          // Upsert this page immediately — don't accumulate all pages in memory
          await stakeholderDao.upsertMany(pageRows, (inserted, total, percent) => {
            // Each page's save progress is a small sub-slice; keep it subtle
            const saveSlice = Math.round(percent * 0.02); // max 2 % per page save
            dispatch(updateInitialSyncProgress({
              progress: Math.min(downloadProgress + saveSlice, 54),
              message: `Saving Stakeholders... page ${pageNumber} (${totalDownloaded + inserted} saved)`,
            }));
          });
          totalDownloaded += pageRows.length;
        }

        // Advance cursor before updating progress so the message is accurate
        if (nextCursor !== null) {
          cursor = nextCursor;
          // Asymptotic progress: close half the gap between current and 55 %
          downloadProgress = Math.round(downloadProgress + (55 - downloadProgress) / 2);
          dispatch(updateInitialSyncProgress({
            progress: Math.min(downloadProgress, 54),
            message: `Downloading Stakeholders... ${totalDownloaded} so far`,
          }));
        } else {
          // Last page — we're done downloading stakeholders
          break;
        }
      }

      console.log(`✅ [Initial Sync] All stakeholders downloaded and saved: ${totalDownloaded} total.`);
      dispatch(updateInitialSyncProgress({ progress: 55, message: `Stakeholders ready (${totalDownloaded})` }));

      // ── Step 2: Download Facilities (Police Stations, Healthcare Centers) ──
      console.log('🔄 [Initial Sync] Fetching facilities from backend...');
      dispatch(updateInitialSyncProgress({ progress: 60, message: 'Downloading Facilities...' }));
      const facilitiesRes = await facilityService.syncOffline();
      const facilities = facilitiesRes.data?.data || facilitiesRes.data || [];
      
      console.log(`✅ [Initial Sync] Received ${facilities.length} facilities from backend.`);
      dispatch(updateInitialSyncProgress({ progress: 80, message: 'Saving Facilities to database...' }));
      if (Array.isArray(facilities) && facilities.length > 0) {
        console.log(`💾 [Initial Sync] Saving ${facilities.length} facilities into SQLite database...`);
        await facilityDao.upsertMany(facilities, (inserted, total, percent) => {
          const scaledProgress = 60 + Math.round(percent * 0.3); // Scale 0-100 to 60-90
          dispatch(updateInitialSyncProgress({ 
            progress: scaledProgress, 
            message: `Saving Facilities... ${inserted} / ${total} (${percent}%)`,
          }));
        });
        console.log('✅ [Initial Sync] Facilities saved to SQLite successfully.');
      }

      // ── Step 3: Complete ────────────────────────────────────────────────────
      console.log('🎉 [Initial Sync] All data downloaded and saved to SQLite! Sync complete.');
      dispatch(updateInitialSyncProgress({ progress: 100, message: 'Finalizing setup...' }));
      await appStateDao.set('initial_sync_done', 'true');
      dispatch(initialSyncComplete());

    } catch (error: any) {
      console.error('❌ [Initial Sync] Failed:', error);
      dispatch(initialSyncFailed(error.message || 'Failed to download necessary data. Please try again.'));
    }
  }
);

// SYNC FIX (round 2): true mutex for runAutoSync, separate from the Redux
// `isSyncing` flag. The Redux check (`getState().sync.isSyncing`) and the
// flag flip (`dispatch(startSync())`) are two separate, non-atomic steps
// separated by `await NetInfo.fetch()`. When connectivity flaps rapidly —
// connect/disconnect/connect within a second or two, exactly what "internet
// cuts multiple times" produces — AppNavigator's global NetInfo listener can
// fire this thunk again before the first call has flipped isSyncing to true.
// Both calls then read isSyncing=false and both proceed, racing on the same
// sync_queue rows: double media uploads, lost markCompleted/markFailed writes
// when two updates land on the same row, corrupted progress percentages.
// This is the core mechanism behind the reported "entire sync pipeline
// breaking" under flaky connectivity. A plain module-level boolean is
// checked and set synchronously, before any `await`, so there's no window
// for a second concurrent call to slip through.
// COUNT FIX: surveys and media each track their own is_synced column —
// they are NOT in sync_queue. The old count refresh only queried sync_queue,
// so the Sync Center always showed 0 pending even with many surveys waiting.
// This helper aggregates all three sources so the UI reflects reality.
export const refreshSyncCountsThunk = createAsyncThunk(
  'sync/refreshCounts',
  async (_, { dispatch }) => {
    await refreshSyncCounts(dispatch);
  }
);

const refreshSyncCounts = async (dispatch: any) => {
  const [pending, failed, dead] = await Promise.all([
    syncQueueDao.getLogicalPendingCount(),
    syncQueueDao.getFailedCount(),
    syncQueueDao.getDeadLetterCount(),
  ]);
  
  dispatch(setPendingCount(pending));
  dispatch(setFailedCount(failed));
  dispatch(setDeadLetterCount(dead));
};

let isAutoSyncRunning = false;

// Upper bound on how many times one runAutoSync invocation will loop over the
// pending queue. Each pass uploads everything currently eligible; a pass only
// happens again if the previous one made real progress, so this cap is a
// backstop rather than the normal exit condition.
const MAX_SYNC_PASSES = 25;
const PASS_DELAY_MS = 1500;

/**
 * Classify an error as permanently unfixable by retrying.
 *
 * api.ts already retries genuinely transient failures (no response / 5xx) twice
 * in-process. What reaches here as a 4xx is a considered rejection from the
 * server — a validation failure, an unknown enum value, a district/ownership
 * denial, or a stakeholder already locked by someone else. Retrying those eight
 * more times over nine hours accomplishes nothing, so they are dead-lettered
 * immediately and surfaced to the user.
 *
 * Deliberately excluded (still treated as retryable):
 *   401 — the interceptor refreshes the token and replays the request
 *   404 — the server-side survey row may not exist yet on a media-first pass
 *   408 / 429 — explicit "try again later" signals
 */
function isPermanentFailure(err: any): boolean {
  const status = err?.response?.status;
  if (typeof status !== 'number') return false;
  if (status === 401 || status === 404 || status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

/** Extract the most useful message the server or transport gave us. */
function describeError(err: any): string {
  const d = err?.response?.data?.error;
  if (d?.details) return Array.isArray(d.details) ? d.details.join('; ') : String(d.details);
  if (d?.message) return String(d.message);
  return err?.message || 'Unknown error';
}

/**
 * Is the device offline *right now*?
 *
 * Losing connectivity mid-upload must not consume an item's retry budget. With
 * MAX_AUTO_RETRIES attempts and a genuinely flaky connection (the normal case
 * for field enumerators moving between villages), a perfectly valid photo could
 * otherwise burn through every attempt on dropped packets alone and end up
 * dead-lettered — reported to the user as broken when nothing was wrong with it.
 *
 * So on failure we check connectivity: if we are offline, the item is left
 * completely untouched (same retry_count, same backoff window) and the pass is
 * abandoned. It resumes automatically when the NetInfo listener fires.
 */
async function isOfflineNow(): Promise<boolean> {
  try {
    const s = await NetInfo.fetch();
    return !s.isConnected;
  } catch {
    return false;
  }
}

export const runAutoSync = createAsyncThunk(
  'sync/runAutoSync',
  async (_, { dispatch, getState }) => {
    if (isAutoSyncRunning) return;
    isAutoSyncRunning = true;

    const state = getState() as RootState;
    if (state.sync.isSyncing) { isAutoSyncRunning = false; return; }

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      // Being offline is a normal state for this app, not a sync failure.
      //
      // This branch used to dispatch startSync() + syncFailed('No internet
      // connection'). That was tolerable when the only automatic trigger was a
      // connectivity transition, but the pipeline is now also woken by a 60-second
      // heartbeat (needed so elapsed backoff windows actually get retried on a
      // stable connection). Keeping the old behaviour would push a fresh "sync
      // failed" error into Redux every minute for as long as the enumerator is out
      // of coverage — alarming, and wrong: nothing failed.
      //
      // Manual syncs are unaffected: SyncStatusScreen.performSync() runs its own
      // NetInfo check and shows an Alert before it ever dispatches this thunk, so
      // tapping "Sync Now" while offline still gives clear feedback.
      // We refresh the counts so the pending badge stays accurate, then exit quietly.
      try { await refreshSyncCounts(dispatch); } catch { /* best-effort */ }
      isAutoSyncRunning = false;
      return;
    }

    dispatch(startSync());

    try {
      dispatch(updateSyncProgress(5));

      // ── Bounded multi-pass upload loop ─────────────────────────────────────
      // This replaces the previous tail-recursive re-trigger:
      //
      //   isAutoSyncRunning = false;
      //   await sleep(3000);
      //   dispatch(runAutoSync());      // not awaited
      //
      // which had two serious defects:
      //   1. Because the re-dispatch was not awaited, the parent fell through to
      //      its own `finally`, which set isAutoSyncRunning = false while the
      //      child was still mid-flight. The mutex was defeated by its own
      //      recursion, letting a third concurrent run enter and race on the
      //      same rows (duplicate uploads, lost markSynced/markFailed writes).
      //   2. It had no termination condition other than "nothing left pending",
      //      so any permanently-failing item looped every 3 s forever.
      //
      // Now: one mutex acquisition, a bounded loop, and each pass must make
      // measurable progress to earn another one. The mutex is released exactly
      // once, in `finally`.
      let pass = 0;
      let grandTotalProcessed = 0;

      while (pass < MAX_SYNC_PASSES) {
        pass++;

        // Only rows eligible right now: unsynced, under the retry cap, and past
        // their backoff window. Dead-lettered rows are intentionally invisible
        // here — they are reported to the user instead of retried.
        const retryableSurveys = await surveyDao.getRetryable();
        const retryableMedia = await mediaDao.getRetryable();
        const retryableQueue = await syncQueueDao.getRetryable();
        const pendingCompletions = await surveyDao.getPendingCompletion();

        const workThisPass =
          retryableSurveys.length + retryableMedia.length +
          retryableQueue.length + pendingCompletions.length;

        if (workThisPass === 0) {
          if (pass === 1) console.log('[Sync] Nothing eligible to upload.');
          break;
        }

        console.log(
          `[Sync] Pass ${pass}: ${retryableSurveys.length} survey(s), ${retryableMedia.length} media, ` +
          `${retryableQueue.length} queue item(s), ${pendingCompletions.length} stranded completion(s)`
        );

        // Progress accounting for this pass. Text + media + one complete() per survey.
        const totalWorkItems =
          retryableSurveys.length + retryableMedia.length +
          retryableSurveys.length + pendingCompletions.length;
        let completedWorkItems = 0;

        const updateProgress = () => {
          if (totalWorkItems === 0) return;
          // 5% → 90%. Capped at 90 so the getChanges/cleanup phase below can
          // advance monotonically to 100 without ever moving the bar backwards.
          const pct = 5 + Math.floor((completedWorkItems / totalWorkItems) * 85);
          dispatch(updateSyncProgress(Math.min(pct, 90)));
        };

        let progressedThisPass = 0;
        // Set when connectivity is lost mid-pass. Aborts the remaining work
        // without penalising any item's retry budget.
        let networkLost = false;

        // ── Stranded completions (text + media all uploaded, complete() failed) ──
        for (const survey of pendingCompletions) {
          if (networkLost) break;
          try {
            let serverSurveyId = survey.id;
            if (survey.stakeholder_id) {
              try {
                const svRes = await surveyService.getByStakeholder(survey.stakeholder_id);
                if (svRes.data?.data?.id) serverSurveyId = svRes.data.data.id;
              } catch { /* fall back to local id */ }
            }
            await surveyService.complete(serverSurveyId);
            await surveyDao.markCompleted(survey.id);
            await surveyDao.clearRetryState(survey.id);
            if (survey.stakeholder_id) {
              await stakeholderDao.removeLockedStakeholders([survey.stakeholder_id]);
            }
            progressedThisPass++;
            completedWorkItems++;
            updateProgress();
            console.log(`[Sync] Recovered stranded completion for survey ${survey.id}`);
          } catch (err: any) {
            const msg = describeError(err);
            if (await isOfflineNow()) {
              networkLost = true;
              console.log('[Sync] Connection lost; leaving retry state untouched.');
            } else if (isPermanentFailure(err)) {
              // e.g. 409 — another enumerator locked this stakeholder. Retrying
              // will never succeed; surface it instead of looping.
              await surveyDao.markUnrecoverable(survey.id, `Completion rejected: ${msg}`);
              console.error(`[Sync] Completion permanently rejected for ${survey.id}: ${msg}`);
            } else {
              await surveyDao.markFailed(survey.id, msg);
              console.warn(`[Sync] Completion retry failed for ${survey.id}: ${msg}`);
            }
          }
        }

        // ── Generic sync queue (stakeholder edits, etc.) ───────────────────────
        for (const item of retryableQueue) {
          if (networkLost) break;
          try {
            if (item.entity_type === 'stakeholder' && item.action === 'UPDATE') {
              const payload = JSON.parse(item.payload);
              await stakeholderService.updateStakeholder(item.entity_id, payload);
            } else if (item.entity_type === 'survey' && item.action === 'CREATE') {
              const payload = JSON.parse(item.payload);
              await syncService.upload({
                surveys: [payload],
                phoneValidations: [],
                mediaMetadata: [],
              });
              if (payload.id) await surveyDao.markSynced(payload.id);
            }
            await syncQueueDao.markCompleted(item.id);
            progressedThisPass++;
          } catch (err: any) {
            const msg = describeError(err);
            if (await isOfflineNow()) {
              networkLost = true;
              console.log('[Sync] Connection lost; leaving queue item untouched.');
            } else if (isPermanentFailure(err)) {
              await syncQueueDao.markDead(item.id, msg);
              console.error(`[Sync] Queue item ${item.id} permanently rejected: ${msg}`);
            } else {
              await syncQueueDao.markFailed(item.id, msg);
              console.error(`[Sync] Queue item ${item.id} failed (attempt ${(item.retry_count || 0) + 1}): ${msg}`);
            }
          }
        }

        // ── Per-survey pipeline: text → media → complete ───────────────────────
        const surveyIdsToProcess = new Set<string>();
        retryableSurveys.forEach((s: any) => surveyIdsToProcess.add(s.id));
        retryableMedia.forEach((m: any) => surveyIdsToProcess.add(m.survey_id));

        for (const localSurveyId of surveyIdsToProcess) {
          if (networkLost) break;
          const surveyLocal = retryableSurveys.find((s: any) => s.id === localSurveyId);
          const mediaForThisSurvey = retryableMedia.filter((m: any) => m.survey_id === localSurveyId);
          let serverSurveyId = localSurveyId;
          const stakeholderId =
            surveyLocal?.stakeholder_id ||
            mediaForThisSurvey[0]?.stakeholder_id ||
            (localSurveyId.startsWith('draft_') ? localSurveyId.replace('draft_', '') : null);

          // ── Step A: text payload ────────────────────────────────────────────
          if (surveyLocal) {
            const surveyPayload = {
              stakeholderId: surveyLocal.stakeholder_id,
              mobileNumber: surveyLocal.mobile_number,
              email: surveyLocal.email,
              businessCategory: surveyLocal.business_category,
              latitude: surveyLocal.latitude,
              longitude: surveyLocal.longitude,
              gpsAccuracy: surveyLocal.gps_accuracy,
              nearestPoliceStation: surveyLocal.nearest_police_station,
              nearestHealthcareCenter: surveyLocal.nearest_healthcare_center,
              localId: surveyLocal.id,
              subCategories: surveyLocal.sub_categories ? JSON.parse(surveyLocal.sub_categories) : undefined,
              businessName: surveyLocal.business_name || undefined,
              ownerName: surveyLocal.owner_name || undefined,
              district: surveyLocal.district || undefined,
              city: surveyLocal.city || undefined,
              pinCode: surveyLocal.pin_code || undefined,
              businessAddress: surveyLocal.business_address || undefined,
              aadharNumber: surveyLocal.aadhar_number || undefined,
              udyamAadharRegNo: surveyLocal.udyam_aadhar_reg_no || undefined,
              panNumber: surveyLocal.pan_number || undefined,
              description: surveyLocal.description || undefined,
              accommodationFacilities: surveyLocal.accommodation_facilities ? JSON.parse(surveyLocal.accommodation_facilities) : undefined,
              accommodationPolicies: surveyLocal.accommodation_policies || undefined,
              workingHours: surveyLocal.working_hours ? JSON.parse(surveyLocal.working_hours) : undefined,
              rooms: surveyLocal.rooms ? JSON.parse(surveyLocal.rooms) : undefined,
              aboutBusiness: surveyLocal.about_business || undefined,
              agreedToTerms: !!surveyLocal.agreed_to_terms,
              declaredInfoCorrect: !!surveyLocal.declared_info_correct,
              acknowledgedDotLiability: !!surveyLocal.acknowledged_dot_liability,
            };

            try {
              // NEW-3 FIX: never write full survey PII to device logs in release
              // builds (RN does not strip console.* by default → visible in logcat).
              if (__DEV__) {
                console.log(`[Sync] Uploading text payload for survey ${localSurveyId}`);
              }
              await syncService.upload({
                surveys: [surveyPayload],
                phoneValidations: [],
                mediaMetadata: [],
              });
              await surveyDao.markSynced(localSurveyId);
              // Give the complete() phase a fresh retry budget — the text upload
              // succeeded, so failures from here on are a different problem.
              await surveyDao.clearRetryState(localSurveyId);
              progressedThisPass++;
              completedWorkItems++;
              updateProgress();
            } catch (err: any) {
              const msg = describeError(err);
              if (await isOfflineNow()) {
                networkLost = true;
                console.log('[Sync] Connection lost during text upload; retry state untouched.');
              } else if (isPermanentFailure(err)) {
                await surveyDao.markUnrecoverable(localSurveyId, msg);
                console.error(`[Sync] Survey ${localSurveyId} permanently rejected: ${msg}`);
              } else {
                await surveyDao.markFailed(localSurveyId, msg);
                console.error(`[Sync] Survey ${localSurveyId} text upload failed: ${msg}`);
              }
              // Cannot attach media to a survey the server does not have yet.
              continue;
            }
          }

          // ── Step B: resolve the server-side survey id ───────────────────────
          if (stakeholderId) {
            try {
              const svRes = await surveyService.getByStakeholder(stakeholderId);
              if (svRes.data?.data?.id) serverSurveyId = svRes.data.data.id;
            } catch { /* keep local id as fallback */ }
          }

          // ── Step C: media, bounded concurrency ──────────────────────────────
          const MEDIA_UPLOAD_CONCURRENCY = 3;
          const uploadOne = async (media: any) => {
            const net = await NetInfo.fetch();
            if (!net.isConnected) throw new Error('Network lost during upload');

            const formData = new FormData();
            formData.append('surveyId', serverSurveyId);
            formData.append('type', media.type);
            if (media.photo_category) formData.append('photoCategory', media.photo_category);
            // Compare against null/undefined rather than truthiness: latitude or
            // longitude of exactly 0 is a valid coordinate and was being dropped.
            if (media.latitude != null) formData.append('latitude', String(media.latitude));
            if (media.longitude != null) formData.append('longitude', String(media.longitude));
            if (media.gps_accuracy != null) formData.append('gpsAccuracy', String(media.gps_accuracy));
            if (media.duration != null) formData.append('duration', String(media.duration));
            formData.append('localId', media.id);

            formData.append('file', {
              uri: media.file_path,
              type: media.mime_type || 'image/jpeg',
              name: media.file_name || `upload_${Date.now()}`,
            } as any);

            await mediaService.upload(formData);
            await mediaDao.markSynced(media.id);
          };

          const failedMedia: string[] = [];
          for (let c = 0; c < mediaForThisSurvey.length; c += MEDIA_UPLOAD_CONCURRENCY) {
            const chunk = mediaForThisSurvey.slice(c, c + MEDIA_UPLOAD_CONCURRENCY);
            const settled = await Promise.allSettled(chunk.map(uploadOne));
            for (let idx = 0; idx < settled.length; idx++) {
              const res = settled[idx];
              const media = chunk[idx];
              if (res.status === 'fulfilled') {
                progressedThisPass++;
                completedWorkItems++;
                updateProgress();
                continue;
              }
              const err: any = (res as PromiseRejectedResult).reason;
              const msg = describeError(err);
              failedMedia.push(media.id);

              // A local file that no longer exists (camera cache evicted by the
              // OS, storage cleared) can never upload. RN surfaces this as an
              // unhelpful network-ish error, so match on the message. Checked
              // before the offline test because a missing file is permanent
              // regardless of connectivity.
              const looksMissingFile = /ENOENT|no such file|could not be found|failed to read|not a file/i.test(msg);
              if (looksMissingFile) {
                await mediaDao.markUnrecoverable(media.id, `Local file missing: ${msg}`);
                console.error(`[Sync] Media ${media.id} file is gone locally - dead-lettered`);
              } else if (await isOfflineNow()) {
                networkLost = true;
                console.log(`[Sync] Connection lost uploading ${media.id}; retry state untouched.`);
              } else if (isPermanentFailure(err)) {
                await mediaDao.markUnrecoverable(media.id, msg);
                console.error(`[Sync] Media ${media.id} permanently rejected: ${msg}`);
              } else {
                await mediaDao.markFailed(media.id, msg);
                console.error(`[Sync] Media ${media.id} upload failed: ${msg}`);
              }
            }
            if (networkLost) break;
          }

          // complete() must only run when every file for this survey is on the
          // server. Skip it this pass; already-uploaded files stay marked synced
          // so a later pass only retries what is genuinely outstanding.
          if (failedMedia.length > 0) {
            console.warn(`[Sync] Survey ${localSurveyId}: ${failedMedia.length} media outstanding, deferring completion.`);
            continue;
          }

          // ── Step D: complete ───────────────────────────────────────────────
          // Skip if there is still unsynced media for this survey that simply
          // was not eligible this pass (e.g. sitting in a backoff window).
          const stillPending = await mediaDao.countUnsyncedForSurvey(localSurveyId);
          if (stillPending > 0) {
            console.warn(`[Sync] Survey ${localSurveyId}: ${stillPending} media still pending (backoff), deferring completion.`);
            continue;
          }

          try {
            await surveyService.complete(serverSurveyId);
            await surveyDao.markCompleted(localSurveyId);
            await surveyDao.clearRetryState(localSurveyId);
            progressedThisPass++;
            completedWorkItems++;
            updateProgress();
            console.log(`[Sync] Survey ${localSurveyId} fully synced.`);

            if (stakeholderId) {
              await stakeholderDao.removeLockedStakeholders([stakeholderId]);
            }
          } catch (err: any) {
            const msg = describeError(err);
            if (await isOfflineNow()) {
              networkLost = true;
              console.log('[Sync] Connection lost during completion; retry state untouched.');
            } else if (isPermanentFailure(err)) {
              await surveyDao.markUnrecoverable(localSurveyId, `Completion rejected: ${msg}`);
              console.error(`[Sync] complete() permanently rejected for ${localSurveyId}: ${msg}`);
            } else {
              await surveyDao.markFailed(localSurveyId, msg);
              console.error(`[Sync] complete() failed for ${localSurveyId}: ${msg}`);
            }
          }
        }

        grandTotalProcessed += progressedThisPass;

        // Connectivity went away mid-pass. Stop here; nothing was penalised and
        // the NetInfo listener in AppNavigator will restart the sync on reconnect.
        if (networkLost) {
          console.log('[Sync] Aborting remaining passes — device is offline.');
          break;
        }

        // A pass that uploaded nothing means everything still outstanding is
        // either dead-lettered or waiting on a backoff window. Looping again
        // would spin without accomplishing anything — this is the guard that
        // makes a permanently-failing item cost one attempt instead of an
        // unbounded retry storm.
        if (progressedThisPass === 0) {
          console.log('[Sync] Pass made no progress; stopping. Remaining items are backed off or need attention.');
          break;
        }

        // Anything still eligible right now? If not, we are done.
        const [moreSurveys, moreMedia, moreQueue, moreCompletions] = await Promise.all([
          surveyDao.getRetryable(),
          mediaDao.getRetryable(),
          syncQueueDao.getRetryable(),
          surveyDao.getPendingCompletion(),
        ]);
        if (moreSurveys.length + moreMedia.length + moreQueue.length + moreCompletions.length === 0) break;

        await new Promise<void>(resolve => setTimeout(resolve, PASS_DELAY_MS));
      }

      if (pass >= MAX_SYNC_PASSES) {
        console.warn(`[Sync] Reached the ${MAX_SYNC_PASSES}-pass ceiling; remaining work continues on the next sync.`);
      }

      dispatch(updateSyncProgress(92));

      // ── Pull server-side changes and reconcile local cache ─────────────────
      const lastSync = await appStateDao.get('last_sync_time');
      try {
        const changes = await syncService.getChanges(lastSync || undefined);
        dispatch(updateSyncProgress(96));

        // removeLockedStakeholders now refuses to delete any stakeholder that
        // still holds unsynced survey or media rows, so this can no longer
        // destroy pending field data.
        const lockedIds = changes.data?.data?.lockedStakeholderIds || changes.data?.lockedStakeholderIds || [];
        if (Array.isArray(lockedIds) && lockedIds.length > 0) {
          await stakeholderDao.removeLockedStakeholders(lockedIds);
        }
      } catch (err: any) {
        console.warn('[Sync] Failed to fetch server changes:', err.message);
      }

      dispatch(updateSyncProgress(100));

      const syncTime = new Date().toISOString();
      await appStateDao.set('last_sync_time', syncTime);
      dispatch(syncComplete({ timestamp: syncTime }));

      if (grandTotalProcessed > 0) {
        console.log(`[Sync] Completed. ${grandTotalProcessed} item(s) uploaded across ${pass} pass(es).`);

        // A sync rewrites this device's own SQLite rows — surveys marked synced,
        // completed stakeholders purged from the local set. Nothing arrives over
        // the socket for our own writes, so without this announcement any screen
        // currently displayed would keep rendering the pre-sync state until the
        // operator navigated away. Only fired when something actually moved, so
        // an idle sync pass does not cause needless reloads.
        announceLocalDataChange(['stakeholders', 'surveys', 'analytics']);
      }

    } catch (error: any) {
      // Reached only for an unexpected fault in the orchestration itself —
      // per-item upload failures are handled inline and recorded against the row.
      dispatch(syncFailed(error.message || 'Sync failed'));
      console.error('[Sync] Unexpected pipeline error:', error.message);
    } finally {
      // SYNC FIX (round 2): counts must refresh here, not only after a clean
      // run. Previously this block sat at the end of the `try`, right after
      // dispatch(syncComplete(...)) — so any disconnect partway through sync
      // (the per-item loop, the 1-by-1 pipeline, or getChanges) jumped
      // straight to `catch` and skipped it entirely. Every item that had
      // just been marked FAILED or COMPLETED in that run stayed invisible to
      // the UI until some future sync happened to complete end-to-end without
      // a single drop — which with flaky connectivity may never happen. Using
      // `finally` guarantees this runs whether the sync succeeded or threw.
      try { await refreshSyncCounts(dispatch); } catch { /* best-effort; don't let a count-read failure mask the real sync result */ }

      isAutoSyncRunning = false;
    }
  }
);

// SYNC FIX: lets Sync Center's "Retry Failed Now" button bypass the backoff
// window immediately, then kicks off a normal runAutoSync so those items get
// a real attempt right away instead of waiting for their scheduled retry time.
export const retryFailedSyncNow = createAsyncThunk(
  'sync/retryFailedSyncNow',
  async (_, { dispatch }) => {
    // Clears the backoff window across sync_queue, surveys AND media. Previously
    // this only touched sync_queue, so the button did nothing for the failing
    // photos and surveys that are the common case.
    const count = await syncQueueDao.retryEverythingNow();
    if (count > 0) {
      await dispatch(runAutoSync());
    }
    return count;
  }
);

// SYNC FIX: explicit, separate action for re-arming dead-lettered items (those
// that exhausted MAX_AUTO_RETRIES). Kept distinct from retryFailedSyncNow so a
// user doesn't accidentally re-trigger a batch of items that have already
// failed 5+ times without first being made aware that's what they're doing.
export const resetDeadLettersAndRetry = createAsyncThunk(
  'sync/resetDeadLettersAndRetry',
  async (_, { dispatch }) => {
    // Re-arms dead-lettered items across all three sources with a fresh budget.
    const count = await syncQueueDao.resetAllDeadLetters();
    if (count > 0) {
      await dispatch(runAutoSync());
    }
    return count;
  }
);