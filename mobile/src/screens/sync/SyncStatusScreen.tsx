import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import {
  startSync, syncComplete, syncFailed, updateSyncProgress,
  setPendingCount, setFailedCount,
} from '../../store/slices/syncSlice';
import { syncService } from '../../services/api';
import { surveyDao, syncQueueDao, stakeholderDao, appStateDao } from '../../database';
import NetInfo from '@react-native-community/netinfo';
import { colors, spacing, borderRadius, typography } from '../../theme';

export default function SyncStatusScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const { isSyncing, lastSyncTime, pendingCount, failedCount, syncProgress } = useSelector(
    (state: RootState) => state.sync
  );
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(state.isConnected ?? false);
    });
    loadCounts();
    return () => unsubscribe();
  }, []);

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

        const res = await syncService.upload({
          surveys: surveyPayloads,
          phoneValidations: [],
          mediaMetadata: [],
        });

        // Mark synced
        for (const s of unsyncedSurveys) {
          await surveyDao.markSynced(s.id);
        }
      }

      dispatch(updateSyncProgress(50));

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
      <View style={styles.header}>
        <Text style={styles.title}>🔄 Sync Center</Text>
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
        <View style={[styles.statusCard, { borderTopColor: colors.warning }]}>
          <Text style={styles.statusIcon}>📤</Text>
          <Text style={styles.statusValue}>{pendingCount}</Text>
          <Text style={styles.statusLabel}>Pending Uploads</Text>
        </View>
        <View style={[styles.statusCard, { borderTopColor: colors.error }]}>
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
            <View style={[styles.progressFill, { width: `${syncProgress}%` }]} />
          </View>
        </View>
      )}

      {/* Sync Button */}
      <TouchableOpacity
        style={[styles.syncButton, (isSyncing || !isOnline) && styles.syncButtonDisabled]}
        onPress={performSync}
        disabled={isSyncing || !isOnline}
      >
        {isSyncing ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.syncButtonText}>
            {isOnline ? '🔄 Sync Now' : '📵 No Connection'}
          </Text>
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
  },
  syncTimeLabel: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm },
  syncTimeValue: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  statusGrid: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xxl },
  statusCard: {
    flex: 1, backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.xl, alignItems: 'center', borderWidth: 1, borderColor: colors.border,
    borderTopWidth: 3,
  },
  statusIcon: { fontSize: 28, marginBottom: spacing.sm },
  statusValue: { ...typography.stat, color: colors.textPrimary, fontSize: 28 },
  statusLabel: { ...typography.caption, color: colors.textMuted },
  progressCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.xl, marginBottom: spacing.xl, borderWidth: 1, borderColor: colors.primary,
  },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  progressTitle: { ...typography.body, fontWeight: '600', color: colors.primary },
  progressPercent: { ...typography.body, fontWeight: '700', color: colors.primary },
  progressBar: { height: 6, backgroundColor: colors.border, borderRadius: 3 },
  progressFill: { height: 6, backgroundColor: colors.primary, borderRadius: 3 },
  syncButton: {
    backgroundColor: colors.primary, borderRadius: borderRadius.md,
    padding: spacing.lg, alignItems: 'center', marginBottom: spacing.xxl,
  },
  syncButtonDisabled: { opacity: 0.5 },
  syncButtonText: { ...typography.button, color: '#FFF', fontSize: 16 },
  infoCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.xl, borderWidth: 1, borderColor: colors.border,
  },
  infoTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.md },
  infoText: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.xs },
});
