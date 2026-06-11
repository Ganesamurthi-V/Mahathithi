import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Animated, Easing } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import {
  startSync, syncComplete, syncFailed, updateSyncProgress,
  setPendingCount, setFailedCount,
} from '../../store/slices/syncSlice';
import { syncService, mediaService, surveyService } from '../../services/api';
import { surveyDao, syncQueueDao, stakeholderDao, appStateDao, mediaDao } from '../../database';
import NetInfo from '@react-native-community/netinfo';
import { colors, spacing, borderRadius, typography, shadows, animations } from '../../theme';

export default function SyncStatusScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const { isSyncing, lastSyncTime, pendingCount, failedCount, syncProgress } = useSelector(
    (state: RootState) => state.sync
  );
  const [isOnline, setIsOnline] = useState(true);

  // Animations
  const spinAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(state.isConnected ?? false);
    });
    loadCounts();
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: syncProgress,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [syncProgress]);

  useEffect(() => {
    if (isSyncing) {
      Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ).start();
    } else {
      spinAnim.stopAnimation();
      spinAnim.setValue(0);
    }
  }, [isSyncing]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg']
  });

  const loadCounts = async () => {
    const pending = await syncQueueDao.getPendingCount();
    const failed = await syncQueueDao.getFailedCount();
    dispatch(setPendingCount(pending));
    dispatch(setFailedCount(failed));
  };

  const performSync = useCallback(async () => {
    if (isSyncing) return;

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      Alert.alert('Offline', 'No internet connection. Sync will happen automatically when online.');
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

        // Mark synced
        for (const s of unsyncedSurveys) {
          await surveyDao.markSynced(s.id);
        }
      }

      // Step 1.5: Upload Pending Media
      dispatch(updateSyncProgress(50));
      const unsyncedMedia = await mediaDao.getUnsynced();

      if (unsyncedMedia.length > 0) {
        // Build a mapping of local survey IDs to server survey IDs
        const surveyIdMap: Record<string, string> = {};

        for (const media of unsyncedMedia) {
          try {
            const localSurveyId = media.survey_id;

            // Resolve local draft ID to server survey ID
            let serverSurveyId = surveyIdMap[localSurveyId];
            if (!serverSurveyId) {
              // Extract stakeholderId from draft_<stakeholderId> pattern
              const stakeholderId = localSurveyId?.startsWith('draft_')
                ? localSurveyId.replace('draft_', '')
                : null;

              if (stakeholderId) {
                // Look up the server survey for this stakeholder
                try {
                  const svRes = await surveyService.getByStakeholder(stakeholderId);
                  serverSurveyId = svRes.data?.data?.id;
                } catch { /* no server survey yet */ }
              }

              // If it's already a server UUID, use it directly
              if (!serverSurveyId) {
                serverSurveyId = localSurveyId;
              }

              surveyIdMap[localSurveyId] = serverSurveyId;
            }

            if (!serverSurveyId) {
              console.warn(`Skipping media ${media.id}: no server survey ID found`);
              continue;
            }

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
            console.log(`✅ Media uploaded: ${media.type} ${media.id}`);
          } catch (mediaErr: any) {
            console.error(`❌ Media upload failed for ${media.id}:`, mediaErr?.response?.data || mediaErr.message);
            // Continue with next media item — don't block the whole sync
          }
        }
      }

      dispatch(updateSyncProgress(75));

      // Step 2: Get changes from server (locked stakeholders, etc.)
      const lastSync = await appStateDao.get('last_sync_time');
      const changes = await syncService.getChanges(lastSync || undefined);

      dispatch(updateSyncProgress(75));

      // Step 3: Remove locked stakeholders from local DB
      if (changes.data.data.lockedStakeholderIds?.length > 0) {
        await stakeholderDao.removeLockedStakeholders(changes.data.data.lockedStakeholderIds);
      }

      dispatch(updateSyncProgress(90));

      // Step 4: Update sync timestamp
      const syncTime = new Date().toISOString();
      await appStateDao.set('last_sync_time', syncTime);

      // Clear completed sync queue items
      dispatch(syncComplete({ timestamp: syncTime }));
      await loadCounts();

    } catch (error: any) {
      dispatch(syncFailed(error.message || 'Sync failed'));
      Alert.alert('Sync Error', 'Some items could not be synced. They will be retried automatically.');
    }
  }, [dispatch, isSyncing]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Animated.View style={{ opacity: fadeAnim }}>
        <View style={styles.header}>
          <Text style={styles.title}>Sync Center</Text>
          <View style={[styles.onlineBadge, { backgroundColor: isOnline ? colors.successBg : colors.errorBg }]}>
            <View style={[styles.onlineDot, { backgroundColor: isOnline ? colors.success : colors.error }]} />
            <Text style={[styles.onlineText, { color: isOnline ? colors.success : colors.error }]}>
              {isOnline ? 'Online' : 'Offline'}
            </Text>
          </View>
        </View>

        {/* Last Sync */}
        <View style={styles.syncTimeCard}>
          <Text style={styles.syncTimeLabel}>Last Successful Sync</Text>
          <Text style={styles.syncTimeValue}>
            {lastSyncTime ? new Date(lastSyncTime).toLocaleString() : 'Never synced'}
          </Text>
        </View>

        {/* Sync Status Cards */}
        <View style={styles.statusGrid}>
          <View style={[styles.statusCard, { borderLeftColor: colors.warning }]}>
            <Text style={styles.statusIcon}>📤</Text>
            <Text style={styles.statusValue}>{pendingCount}</Text>
            <Text style={styles.statusLabel}>Pending Uploads</Text>
          </View>
          <View style={[styles.statusCard, { borderLeftColor: colors.error }]}>
            <Text style={styles.statusIcon}>⚠️</Text>
            <Text style={styles.statusValue}>{failedCount}</Text>
            <Text style={styles.statusLabel}>Failed Uploads</Text>
          </View>
        </View>

        {/* Progress Bar */}
        {isSyncing && (
          <View style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressTitle}>Syncing...</Text>
              <Text style={styles.progressPercent}>{syncProgress}%</Text>
            </View>
            <View style={styles.progressBar}>
              <Animated.View style={[
                styles.progressFill, 
                { width: progressAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }
              ]} />
            </View>
          </View>
        )}

        {/* Sync Button */}
        <TouchableOpacity
          style={[styles.syncButton, (isSyncing || !isOnline) && styles.syncButtonDisabled]}
          onPress={performSync}
          disabled={isSyncing || !isOnline}
          activeOpacity={0.9}
        >
          {isSyncing ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Animated.Text style={{ fontSize: 20, marginRight: 8, transform: [{ rotate: spin }] }}>
                🔄
              </Animated.Text>
              <Text style={styles.syncButtonText}>Syncing Data...</Text>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontSize: 20, marginRight: 8 }}>{isOnline ? '🔄' : '📵'}</Text>
              <Text style={styles.syncButtonText}>
                {isOnline ? 'Sync Now' : 'No Connection'}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Info */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>ℹ️ How Sync Works</Text>
          <Text style={styles.infoText}>• Surveys are saved locally when offline</Text>
          <Text style={styles.infoText}>• Auto-sync triggers when internet is available</Text>
          <Text style={styles.infoText}>• Failed uploads are retried automatically</Text>
          <Text style={styles.infoText}>• Completed stakeholders are removed from your list</Text>
        </View>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { padding: spacing.xl, paddingBottom: 100 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xxl },
  title: { ...typography.h2, color: colors.textPrimary },
  onlineBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: borderRadius.full },
  onlineDot: { width: 8, height: 8, borderRadius: 4 },
  onlineText: { fontSize: 12, fontWeight: '700' },
  syncTimeCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.xl, marginBottom: spacing.xl, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center',
    ...shadows.card,
  },
  syncTimeLabel: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm },
  syncTimeValue: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  statusGrid: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xxl },
  statusCard: {
    flex: 1, backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.xl, alignItems: 'center', borderWidth: 1, borderColor: colors.border,
    borderLeftWidth: 4,
    ...shadows.card,
  },
  statusIcon: { fontSize: 28, marginBottom: spacing.sm },
  statusValue: { ...typography.stat, color: colors.textPrimary, fontSize: 28 },
  statusLabel: { ...typography.caption, color: colors.textMuted },
  progressCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.xl, marginBottom: spacing.xl, borderWidth: 1, borderColor: colors.primary,
    ...shadows.glow,
  },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  progressTitle: { ...typography.body, fontWeight: '600', color: colors.primary },
  progressPercent: { ...typography.body, fontWeight: '700', color: colors.primary },
  progressBar: { height: 8, backgroundColor: colors.bgInput, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 4 },
  syncButton: {
    backgroundColor: colors.primary, borderRadius: borderRadius.md,
    padding: spacing.lg, alignItems: 'center', marginBottom: spacing.xxl,
    ...shadows.elevated,
  },
  syncButtonDisabled: { opacity: 0.5 },
  syncButtonText: { ...typography.button, color: '#FFF', fontSize: 16 },
  infoCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.xl, borderWidth: 1, borderColor: colors.border,
  },
  infoTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.md },
  infoText: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.xs, lineHeight: 20 },
});
