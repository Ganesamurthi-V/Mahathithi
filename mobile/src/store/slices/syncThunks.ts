import { createAsyncThunk } from '@reduxjs/toolkit';
import NetInfo from '@react-native-community/netinfo';
import { Alert } from 'react-native';
import { RootState } from '../index';
import {
  startSync, syncComplete, syncFailed, updateSyncProgress,
  setPendingCount, setFailedCount
} from './syncSlice';
import { syncService, mediaService, surveyService, stakeholderService } from '../../services/api';
import { surveyDao, syncQueueDao, stakeholderDao, appStateDao, mediaDao } from '../../database';

export const runAutoSync = createAsyncThunk(
  'sync/runAutoSync',
  async (_, { dispatch, getState }) => {
    const state = getState() as RootState;
    if (state.sync.isSyncing) return;

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      return;
    }

    dispatch(startSync());

    try {
      dispatch(updateSyncProgress(10));
      const unsyncedSurveys = await surveyDao.getUnsynced();
      const unsyncedMedia = await mediaDao.getUnsynced();

      // Group by local survey ID to process 1-by-1
      const surveyIdsToProcess = new Set<string>();
      unsyncedSurveys.forEach((s: any) => surveyIdsToProcess.add(s.id));
      unsyncedMedia.forEach((m: any) => surveyIdsToProcess.add(m.survey_id));

      let processedCount = 0;
      const total = surveyIdsToProcess.size;

      // === Generic Sync Queue Pipeline ===
      const pendingSyncItems = await syncQueueDao.getPending();
      for (const item of pendingSyncItems) {
        try {
          if (item.entity_type === 'stakeholder' && item.action === 'UPDATE') {
            const payload = JSON.parse(item.payload);
            await stakeholderService.updateStakeholder(item.entity_id, payload);
          }
          await syncQueueDao.markCompleted(item.id);
        } catch (err: any) {
          console.error(`Sync Queue Item Failed [${item.id}]:`, err.message);
          await syncQueueDao.markFailed(item.id, err.message);
        }
      }

      // === 1-by-1 Pipeline ===
      for (const localSurveyId of surveyIdsToProcess) {
        processedCount++;
        dispatch(updateSyncProgress(10 + Math.floor((processedCount / total) * 70))); // Scales 10% to 80%

        try {
          const surveyLocal = unsyncedSurveys.find((s: any) => s.id === localSurveyId);
          let serverSurveyId = localSurveyId;
          let stakeholderId = surveyLocal?.stakeholder_id || (localSurveyId.startsWith('draft_') ? localSurveyId.replace('draft_', '') : null);

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
              localId: surveyLocal.id,
            };

            await syncService.upload({
              surveys: [surveyPayload],
              phoneValidations: [],
              mediaMetadata: [],
            });
            await surveyDao.markSynced(localSurveyId);
          }

          // Step B: Resolve serverSurveyId from Stakeholder
          if (stakeholderId) {
             try {
               const svRes = await surveyService.getByStakeholder(stakeholderId);
               if (svRes.data?.data?.id) serverSurveyId = svRes.data.data.id;
             } catch { /* ignore if not found */ }
          }

          // Step C: Upload Media for this Survey sequentially
          const surveyMedia = unsyncedMedia.filter((m: any) => m.survey_id === localSurveyId);
          for (const media of surveyMedia) {
             try {
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

               await mediaService.upload(formData);
               await mediaDao.markSynced(media.id);
             } catch (mediaErr: any) {
               console.error(`Media upload failed for ${media.id}`, mediaErr?.response?.data || mediaErr.message);
               // Throw an error to intentionally break this specific survey's pipeline (prevents completion)
               throw new Error(`Media failed: ${media.id}`); 
             }
          }

          // Step D: Complete Survey
          await surveyService.complete(serverSurveyId);
          console.log(`✅ Fully synced survey ${localSurveyId}`);

        } catch (surveyErr: any) {
          // If ANY step in this survey fails (Text, Media, or Complete), it catches here.
          // We log it, and seamlessly let the loop move onto the NEXT survey!
          console.error(`❌ Failed to sync survey ${localSurveyId}:`, surveyErr.message);
        }
      }

      // Step 2: Get changes from server
      const lastSync = await appStateDao.get('last_sync_time');
      const changes = await syncService.getChanges(lastSync || undefined);

      dispatch(updateSyncProgress(85));

      // Step 3: Remove locked stakeholders from local DB
      if (changes.data.data.lockedStakeholderIds?.length > 0) {
        await stakeholderDao.removeLockedStakeholders(changes.data.data.lockedStakeholderIds);
      }

      dispatch(updateSyncProgress(100));

      // Step 4: Update sync timestamp
      const syncTime = new Date().toISOString();
      await appStateDao.set('last_sync_time', syncTime);

      dispatch(syncComplete({ timestamp: syncTime }));
      
      const pending = await syncQueueDao.getPendingCount();
      const failed = await syncQueueDao.getFailedCount();
      dispatch(setPendingCount(pending));
      dispatch(setFailedCount(failed));

    } catch (error: any) {
      dispatch(syncFailed(error.message || 'Sync failed'));
      // Only alert if we are actively viewing a screen that triggers it manually,
      // but since it's an auto-sync, we'll silently fail or log it.
      console.error('AutoSync Error:', error.message);
    }
  }
);
