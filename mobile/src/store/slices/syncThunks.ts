import { createAsyncThunk } from '@reduxjs/toolkit';
import NetInfo from '@react-native-community/netinfo';
import { Alert } from 'react-native';
import { RootState } from '../index';
import {
  startSync, syncComplete, syncFailed, updateSyncProgress,
  setPendingCount, setFailedCount, setDeadLetterCount,
  startInitialSync, updateInitialSyncProgress, initialSyncComplete, initialSyncFailed
} from './syncSlice';
import { syncService, mediaService, surveyService, stakeholderService, facilityService } from '../../services/api';
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

export const runAutoSync = createAsyncThunk(
  'sync/runAutoSync',
  async (_, { dispatch, getState }) => {
    if (isAutoSyncRunning) return;
    isAutoSyncRunning = true;

    const state = getState() as RootState;
    if (state.sync.isSyncing) { isAutoSyncRunning = false; return; }

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      // SYNC BUTTON FIX: previously this returned silently with no Redux
      // dispatch, so the UI had no idea the thunk ran and exited. The sync
      // button remained enabled (good) but tapping it appeared to do nothing
      // — the thunk entered, hit this branch, and vanished. Now we dispatch
      // syncFailed so the Redux state reflects a completed (failed) attempt,
      // counts are refreshed, and any screen listening to sync state gets
      // an update. We still don't show an alert here (this is auto-sync;
      // the SyncStatusScreen's own NetInfo check surfaces the offline state
      // to the user through the badge and button label).
      dispatch(startSync());
      dispatch(syncFailed('No internet connection'));
      try { await refreshSyncCounts(dispatch); } catch { /* best-effort */ }
      isAutoSyncRunning = false;
      return;
    }

    dispatch(startSync());

    try {
      dispatch(updateSyncProgress(10));
      const unsyncedSurveys = await surveyDao.getUnsynced();
      const unsyncedMedia = await mediaDao.getUnsynced();

      // Calculate total work items for accurate progress
      // Text uploads + media uploads + complete calls = total steps
      const totalTextUploads = unsyncedSurveys.length;
      const totalMediaUploads = unsyncedMedia.length;
      const totalWorkItems = totalTextUploads + totalMediaUploads + totalTextUploads; // text + media + complete per survey
      let completedWorkItems = 0;

      const updateProgress = () => {
        if (totalWorkItems === 0) return;
        // Scale progress from 10% to 90% based on work completed
        const pct = 10 + Math.floor((completedWorkItems / totalWorkItems) * 80);
        dispatch(updateSyncProgress(Math.min(pct, 90)));
      };

      // Group by local survey ID to process 1-by-1
      const surveyIdsToProcess = new Set<string>();
      unsyncedSurveys.forEach((s: any) => surveyIdsToProcess.add(s.id));
      unsyncedMedia.forEach((m: any) => surveyIdsToProcess.add(m.survey_id));

      let processedCount = 0;
      const total = surveyIdsToProcess.size;

      // === Scenario E FIX: Retry complete() for surveys whose connection dropped after all media was uploaded ===
      // These are surveys where is_synced=1 AND is_completed=0 — everything made it to the server
      // except the final complete() call. Without this, the stakeholder stays OPEN on the server forever.
      const pendingCompletions = await surveyDao.getPendingCompletion();
      if (pendingCompletions.length > 0) {
        console.log(`🔄 [Sync] Found ${pendingCompletions.length} stranded completions (Scenario E). Retrying...`);
      }
      for (const survey of pendingCompletions) {
        try {
          // Resolve the real server survey ID from stakeholder
          let serverSurveyId = survey.id;
          if (survey.stakeholder_id) {
            try {
              const svRes = await surveyService.getByStakeholder(survey.stakeholder_id);
              if (svRes.data?.data?.id) serverSurveyId = svRes.data.data.id;
            } catch { /* use local id as fallback */ }
          }
          await surveyService.complete(serverSurveyId);
          await surveyDao.markCompleted(survey.id);
          if (survey.stakeholder_id) {
            await stakeholderDao.removeLockedStakeholders([survey.stakeholder_id]);
          }
          console.log(`✅ [Sync] Retried complete() for stranded survey ${survey.id}`);
        } catch (err: any) {
          console.warn(`[Sync] Stranded complete() retry failed for ${survey.id}:`, err.message);
          // Will retry on next sync run — survey remains is_completed=0
        }
      }

      // === Generic Sync Queue Pipeline ===
      // SYNC FIX: getRetryable() returns PENDING items AND FAILED items whose
      // backoff window has elapsed and are still under the retry cap. Previously
      // this called getPending() which only ever saw PENDING — once an item hit
      // FAILED it was retried by nothing, forever. This is the fix for stakeholder
      // edits in particular, since unlike survey/media they have no SQLite-side
      // fallback signal (is_synced=0) to catch them via the 1-by-1 pipeline below.
      const pendingSyncItems = await syncQueueDao.getRetryable();
      for (const item of pendingSyncItems) {
        try {
          if (item.entity_type === 'stakeholder' && item.action === 'UPDATE') {
            const payload = JSON.parse(item.payload);
            await stakeholderService.updateStakeholder(item.entity_id, payload);
          } else if (item.entity_type === 'survey' && item.action === 'CREATE') {
            // BUG 1 FIX: Handle offline-queued survey text payloads
            const payload = JSON.parse(item.payload);
            await syncService.upload({
              surveys: [payload],
              phoneValidations: [],
              mediaMetadata: [],
            });
            // Mark the local survey as synced so media-only runs can pick it up
            await surveyDao.markSynced(payload.id);
          }
          await syncQueueDao.markCompleted(item.id);
        } catch (err: any) {
          console.error(`Sync Queue Item Failed [${item.id}] (attempt ${(item.retry_count || 0) + 1}):`, err.message);
          await syncQueueDao.markFailed(item.id, err.message);
        }
      }

      // === 1-by-1 Pipeline ===
      for (const localSurveyId of surveyIdsToProcess) {
        processedCount++;

        try {
          const surveyLocal = unsyncedSurveys.find((s: any) => s.id === localSurveyId);
          let serverSurveyId = localSurveyId;
          // BUG 3 FIX: when survey is already synced (media-only run), stakeholder_id
          // comes from the media row instead of the missing surveyLocal.
          const mediaForThisSurvey = unsyncedMedia.filter((m: any) => m.survey_id === localSurveyId);
          let stakeholderId =
            surveyLocal?.stakeholder_id ||
            mediaForThisSurvey[0]?.stakeholder_id ||
            (localSurveyId.startsWith('draft_') ? localSurveyId.replace('draft_', '') : null);

          // Step A: Upload Text Payload (if unsynced)
          if (surveyLocal) {
            const surveyPayload = {
              stakeholderId: surveyLocal.stakeholder_id,
              contactPerson: surveyLocal.contact_person,
              designation: surveyLocal.designation,
              mobileNumber: surveyLocal.mobile_number,
              email: surveyLocal.email,
              website: surveyLocal.website,
              businessCategory: surveyLocal.business_category,
              notes: surveyLocal.notes,
              gstNumber: surveyLocal.gst_number,
              organizationType: surveyLocal.organization_type,
              remarks: surveyLocal.remarks,
              latitude: surveyLocal.latitude,
              longitude: surveyLocal.longitude,
              gpsAccuracy: surveyLocal.gps_accuracy,
              nearestPoliceStation: surveyLocal.nearest_police_station,
              nearestHealthcareCenter: surveyLocal.nearest_healthcare_center,
              localId: surveyLocal.id,
              // ─── New Plan fields (Step 1-8) ────────────────────────────────
              // Step 1
              subCategories: surveyLocal.sub_categories ? JSON.parse(surveyLocal.sub_categories) : undefined,
              // Step 2
              businessName: surveyLocal.business_name || undefined,
              ownerName: surveyLocal.owner_name || undefined,
              district: surveyLocal.district || undefined,
              city: surveyLocal.city || undefined,
              taluka: surveyLocal.taluka || undefined,
              village: surveyLocal.village || undefined,
              pinCode: surveyLocal.pin_code || undefined,
              businessAddress: surveyLocal.business_address || undefined,
              workingAddress: surveyLocal.working_address || undefined,
              maleEmployees: surveyLocal.male_employees ?? undefined,
              femaleEmployees: surveyLocal.female_employees ?? undefined,
              landline: surveyLocal.landline || undefined,
              alternateMobile: surveyLocal.alternate_mobile || undefined,
              alternateEmail: surveyLocal.alternate_email || undefined,
              aadharNumber: surveyLocal.aadhar_number || undefined,
              udyamAadharRegNo: surveyLocal.udyam_aadhar_reg_no || undefined,
              fssaiNumber: surveyLocal.fssai_number || undefined,
              // Step 4
              description: surveyLocal.description || undefined,
              accommodationFacilities: surveyLocal.accommodation_facilities ? JSON.parse(surveyLocal.accommodation_facilities) : undefined,
              accommodationPolicies: surveyLocal.accommodation_policies || undefined,
              workingHours: surveyLocal.working_hours ? JSON.parse(surveyLocal.working_hours) : undefined,
              faq: surveyLocal.faq ? JSON.parse(surveyLocal.faq) : undefined,
              // Step 5
              rooms: surveyLocal.rooms ? JSON.parse(surveyLocal.rooms) : undefined,
              couponCodes: surveyLocal.coupon_codes ? JSON.parse(surveyLocal.coupon_codes) : undefined,
              saleOff: surveyLocal.sale_off ?? undefined,
              additionalServiceFees: surveyLocal.additional_service_fees ? JSON.parse(surveyLocal.additional_service_fees) : undefined,
              bookingNote: surveyLocal.booking_note || undefined,
              // Step 6
              socialLinks: surveyLocal.social_links ? JSON.parse(surveyLocal.social_links) : undefined,
              // Step 7
              aboutBusiness: surveyLocal.about_business || undefined,
              registeredTravelForLife: !!surveyLocal.registered_travel_for_life,
              registeredGreenLeaf: !!surveyLocal.registered_green_leaf,
              receivedTourismAward: !!surveyLocal.received_tourism_award,
              customDocuments: surveyLocal.custom_documents ? JSON.parse(surveyLocal.custom_documents) : undefined,
              // Step 8
              agreedToTerms: !!surveyLocal.agreed_to_terms,
              declaredInfoCorrect: !!surveyLocal.declared_info_correct,
              acknowledgedDotLiability: !!surveyLocal.acknowledged_dot_liability,
            };

            // NEW-3 FIX: never write full survey PII to device logs in release
            // builds (RN does not strip console.* by default → visible in logcat).
            if (__DEV__) {
              console.log(`📤 [Sync] Uploading text payload for survey ${localSurveyId}:`, JSON.stringify(surveyPayload, null, 2));
            }
            await syncService.upload({
              surveys: [surveyPayload],
              phoneValidations: [],
              mediaMetadata: [],
            });
            await surveyDao.markSynced(localSurveyId);
            completedWorkItems++;
            updateProgress();
          }

          // Step B: Resolve serverSurveyId from Stakeholder
          if (stakeholderId) {
             try {
               const svRes = await surveyService.getByStakeholder(stakeholderId);
               if (svRes.data?.data?.id) serverSurveyId = svRes.data.data.id;
             } catch { /* ignore if not found */ }
          }
          console.log(`🔍 [Sync] Resolved serverSurveyId: ${serverSurveyId} (Stakeholder: ${stakeholderId})`);

          // Step C: Upload Media for this Survey with bounded concurrency.
          // PERF: the old loop uploaded files strictly one-at-a-time, so a survey
          // with 4 photos + a video paid the full round-trip latency serially.
          // We now upload in chunks of MEDIA_UPLOAD_CONCURRENCY in parallel.
          // INVARIANT PRESERVED: complete() (Step D) must only run if EVERY media
          // file for this survey uploaded. We collect failures across the whole set
          // and throw before reaching Step D — same effect as the old per-item throw,
          // just without aborting siblings that were already in flight.
          const surveyMedia = unsyncedMedia.filter((m: any) => m.survey_id === localSurveyId);
          const MEDIA_UPLOAD_CONCURRENCY = 3;
          const uploadOne = async (media: any) => {
            // Fail fast if network dropped during sync
            const net = await NetInfo.fetch();
            if (!net.isConnected) throw new Error('Network lost during upload');

            const formData = new FormData();
            formData.append('surveyId', serverSurveyId);
            formData.append('type', media.type);
            if (media.photo_category) formData.append('photoCategory', media.photo_category);
            if (media.latitude) formData.append('latitude', media.latitude.toString());
            if (media.longitude) formData.append('longitude', media.longitude.toString());
            if (media.gps_accuracy) formData.append('gpsAccuracy', media.gps_accuracy.toString());
            if (media.duration) formData.append('duration', media.duration.toString());
            formData.append('localId', media.id);

            formData.append('file', {
              uri: media.file_path,
              type: media.mime_type || 'image/jpeg',
              name: media.file_name || `upload_${Date.now()}`,
            } as any);

            console.log(`📤 [Sync] Uploading media ${media.id} (type: ${media.type}) for survey ${serverSurveyId}`);
            await mediaService.upload(formData);
            await mediaDao.markSynced(media.id);
            completedWorkItems++;
            updateProgress();
            console.log(`✅ [Sync] Media ${media.id} uploaded successfully`);
          };

          const failedMediaIds: string[] = [];
          for (let c = 0; c < surveyMedia.length; c += MEDIA_UPLOAD_CONCURRENCY) {
            const chunk = surveyMedia.slice(c, c + MEDIA_UPLOAD_CONCURRENCY);
            const settled = await Promise.allSettled(chunk.map(uploadOne));
            settled.forEach((res, idx) => {
              if (res.status === 'rejected') {
                const failed = chunk[idx];
                console.error(`Media upload failed for ${failed.id}`, res.reason?.response?.data || res.reason?.message);
                failedMediaIds.push(failed.id);
              }
            });
          }
          if (failedMediaIds.length > 0) {
            // Break this survey's pipeline before complete() — successfully uploaded
            // files are already marked synced, so the next sync run retries only the rest.
            throw new Error(`Media failed: ${failedMediaIds.join(', ')}`);
          }

          // Step D: Complete Survey
          console.log(`🏁 [Sync] Calling complete() on server for survey ${serverSurveyId}`);
          await surveyService.complete(serverSurveyId);
          completedWorkItems++;
          updateProgress();
          // Scenario E FIX: mark locally completed so a future sync doesn't lose this
          await surveyDao.markCompleted(localSurveyId);
          console.log(`✅ Fully synced survey ${localSurveyId}`);
          
          // Remove from local database immediately after successful sync
          if (stakeholderId) {
            await stakeholderDao.removeLockedStakeholders([stakeholderId]);
            console.log(`🗑️ Removed completed survey and stakeholder ${stakeholderId} from local DB`);
          }

        } catch (surveyErr: any) {
          // If ANY step in this survey fails (Text, Media, or Complete), it catches here.
          const errDetail = surveyErr.response?.data?.error?.details || surveyErr.response?.data?.error?.message || surveyErr.message;
          console.error(`❌ Failed to sync survey ${localSurveyId}:`, errDetail);
        }
      }

      // Step 2: Get changes from server
      const lastSync = await appStateDao.get('last_sync_time');
      try {
        const changes = await syncService.getChanges(lastSync || undefined);

        dispatch(updateSyncProgress(85));

        // Step 3: Remove locked stakeholders from local DB
        const lockedIds = changes.data?.data?.lockedStakeholderIds || changes.data?.lockedStakeholderIds || [];
        if (Array.isArray(lockedIds) && lockedIds.length > 0) {
          await stakeholderDao.removeLockedStakeholders(lockedIds);
        }
      } catch (err: any) {
        console.warn('Failed to get changes from server (Step 2/3):', err.message);
      }

      // Step 3.5: Sync Facilities (REMOVED)
      // Facilities are mostly static and are already downloaded during runInitialSync.
      // Re-downloading 13,000+ facilities on every background auto-sync causes massive DB locking/slowdown.
      // If facility updates are needed, this should be a manual trigger or use a 'since' timestamp.

      dispatch(updateSyncProgress(100));

      // Step 4: Update sync timestamp
      const syncTime = new Date().toISOString();
      await appStateDao.set('last_sync_time', syncTime);

      dispatch(syncComplete({ timestamp: syncTime }));

    } catch (error: any) {
      dispatch(syncFailed(error.message || 'Sync failed'));
      // Only alert if we are actively viewing a screen that triggers it manually,
      // but since it's an auto-sync, we'll silently fail or log it.
      console.error('AutoSync Error:', error.message);
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
    const count = await syncQueueDao.retryAllFailedNow();
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
    const count = await syncQueueDao.resetDeadLetters();
    if (count > 0) {
      await dispatch(runAutoSync());
    }
    return count;
  }
);