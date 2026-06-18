import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import {
  startSync, syncComplete, syncFailed, updateSyncProgress,
  setPendingCount, setFailedCount,
} from '../../store/slices/syncSlice';
import { runAutoSync } from '../../store/slices/syncThunks';
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

    dispatch(runAutoSync() as any);
  }, [dispatch, isSyncing]);

  return (
    <SafeAreaView style={styles.container}>
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
    </SafeAreaView>
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
