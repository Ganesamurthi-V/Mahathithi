import { createAsyncThunk } from '@reduxjs/toolkit';
import NetInfo from '@react-native-community/netinfo';
import { Alert } from 'react-native';
import { RootState } from '../index';
import {
  startSync, syncComplete, syncFailed, updateSyncProgress,
  setPendingCount, setFailedCount
} from './syncSlice';
import { syncService, mediaService, surveyService } from '../../services/api';
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
      // Step 1: Upload pending surveys
      dispatch(updateSyncProgress(10));
      const unsyncedSurveys = await surveyDao.getUnsynced();

      if (unsyncedSurveys.length > 0) {
        const surveyPayloads = unsyncedSurveys.map((s: any) => ({
          stakeholderId: s.stakeholder_id,
          contactPerson: s.contact_person,
          designation: s.designation,
          mobileNumber: s.mobile_number,
          email: s.email,
          website: s.website,
          businessCategory: s.business_category,
          notes: s.notes,
          gstNumber: s.gst_number,
          organizationType: s.organization_type,
          remarks: s.remarks,
          latitude: s.latitude,
          longitude: s.longitude,
          gpsAccuracy: s.gps_accuracy,
          localId: s.id,
        }));

        await syncService.upload({
          surveys: surveyPayloads,
          phoneValidations: [],
          mediaMetadata: [],
        });

        for (const s of unsyncedSurveys) {
          await surveyDao.markSynced(s.id);
        }
      }

      // Step 1.5: Upload Pending Media
      dispatch(updateSyncProgress(40));
      const unsyncedMedia = await mediaDao.getUnsynced();
      
      const completedSurveyIds = new Set<string>();

      if (unsyncedMedia.length > 0) {
        const surveyIdMap: Record<string, string> = {};

        for (const media of unsyncedMedia) {
          try {
            const localSurveyId = media.survey_id;
            let serverSurveyId = surveyIdMap[localSurveyId];
            
            if (!serverSurveyId) {
              const stakeholderId = localSurveyId?.startsWith('draft_')
                ? localSurveyId.replace('draft_', '')
                : null;

              if (stakeholderId) {
                try {
                  const svRes = await surveyService.getByStakeholder(stakeholderId);
                  serverSurveyId = svRes.data?.data?.id;
                } catch { /* no server survey yet */ }
              }

              if (!serverSurveyId) serverSurveyId = localSurveyId;
              surveyIdMap[localSurveyId] = serverSurveyId;
            }

            if (!serverSurveyId) continue;

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
            completedSurveyIds.add(serverSurveyId);
          } catch (mediaErr: any) {
            console.error(`Media upload failed for ${media.id}:`, mediaErr?.response?.data || mediaErr.message);
          }
        }
      }

      // Step 1.6: Complete uploaded surveys
      dispatch(updateSyncProgress(70));
      for (const surveyId of completedSurveyIds) {
        try {
          await surveyService.complete(surveyId);
        } catch (completeErr) {
          console.error(`Failed to complete survey ${surveyId}`, completeErr);
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
