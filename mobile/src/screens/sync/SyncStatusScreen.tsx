import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Animated, Easing } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import {
  setPendingCount, setFailedCount, setDeadLetterCount,
} from '../../store/slices/syncSlice';
import { runAutoSync, retryFailedSyncNow, resetDeadLettersAndRetry } from '../../store/slices/syncThunks';
import { syncQueueDao, surveyDao, mediaDao } from '../../database';
import NetInfo from '@react-native-community/netinfo';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';

export default function SyncStatusScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const { isSyncing, lastSyncTime, pendingCount, failedCount, deadLetterCount, syncProgress } = useSelector(
    (state: RootState) => state.sync
  );
  const [isOnline, setIsOnline] = useState(true);
  const [isRetrying, setIsRetrying] = useState(false);

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
    try {
      // COUNT FIX: surveys and media each track pending uploads with is_synced=0
      // in their own tables — they are NOT in sync_queue (which only holds
      // stakeholder updates). Querying only sync_queue meant the counters
      // always showed 0 even when the user had many offline surveys waiting.
      const [pending, failed, dead, unsyncedSurveys, unsyncedMedia] = await Promise.all([
        syncQueueDao.getPendingCount(),
        syncQueueDao.getFailedCount(),
        syncQueueDao.getDeadLetterCount(),
        surveyDao.getUnsyncedCount(),
        mediaDao.getUnsyncedCount(),
      ]);
      dispatch(setPendingCount(pending + unsyncedSurveys + unsyncedMedia));
      dispatch(setFailedCount(failed));
      dispatch(setDeadLetterCount(dead));
    } catch(e) {}
  };

  const performSync = useCallback(async () => {
    if (isSyncing) return;

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      Alert.alert('Offline', 'No internet connection. Sync will happen automatically when online.');
      return;
    }

    await dispatch(runAutoSync() as any);
    loadCounts();
  }, [dispatch, isSyncing]);

  // SYNC FIX: lets the user force an immediate retry of FAILED items instead of
  // waiting for the backoff window. Only touches items still under the retry cap —
  // dead-lettered items need handleResetDeadLetters below instead.
  const handleRetryFailed = useCallback(async () => {
    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      Alert.alert('Offline', 'Connect to the internet to retry failed uploads.');
      return;
    }
    setIsRetrying(true);
    try {
      await dispatch(retryFailedSyncNow() as any);
    } finally {
      setIsRetrying(false);
      loadCounts();
    }
  }, [dispatch]);

  // SYNC FIX: distinct, deliberate action for items that exhausted automatic
  // retries (5 attempts). Asks for confirmation since these have already failed
  // repeatedly and a blind retry without checking connectivity/data first may
  // just fail again.
  const handleResetDeadLetters = useCallback(() => {
    Alert.alert(
      'Retry Stuck Items?',
      `${deadLetterCount} item(s) failed repeatedly and stopped retrying automatically. Make sure you have a stable connection, then try again?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Retry Now',
          onPress: async () => {
            setIsRetrying(true);
            try {
              await dispatch(resetDeadLettersAndRetry() as any);
            } finally {
              setIsRetrying(false);
              loadCounts();
            }
          },
        },
      ]
    );
  }, [dispatch, deadLetterCount]);

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
              <View style={styles.statusIconContainer}>
                <Icon name="cloud-upload" size={28} color={colors.warning} />
              </View>
              <Text style={styles.statusValue}>{pendingCount}</Text>
              <Text style={styles.statusLabel}>Pending Uploads</Text>
            </View>
            <View style={[styles.statusCard, { borderLeftColor: colors.error }]}>
              <View style={styles.statusIconContainer}>
                <Icon name="alert-circle" size={28} color={colors.error} />
              </View>
              <Text style={styles.statusValue}>{failedCount}</Text>
              <Text style={styles.statusLabel}>Retrying</Text>
            </View>
          </View>

          {/* SYNC FIX: Dead-letter card + manual retry, only shown when there's something stuck */}
          {deadLetterCount > 0 && (
            <View style={styles.deadLetterCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
                <Icon name="alert-octagon" size={20} color={colors.error} style={{ marginRight: 8 }} />
                <Text style={styles.deadLetterTitle}>{deadLetterCount} item(s) stuck</Text>
              </View>
              <Text style={styles.deadLetterText}>
                These failed repeatedly and stopped retrying automatically. Check your connection and try again.
              </Text>
              <TouchableOpacity
                style={[styles.retryButton, isRetrying && styles.syncButtonDisabled]}
                onPress={handleResetDeadLetters}
                disabled={isRetrying}
              >
                <Text style={styles.retryButtonText}>Retry Stuck Items</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* SYNC FIX: Manual "retry now" for items still auto-retrying but waiting on backoff */}
          {failedCount > 0 && (
            <TouchableOpacity
              style={[styles.retryNowLink, isRetrying && { opacity: 0.5 }]}
              onPress={handleRetryFailed}
              disabled={isRetrying || !isOnline}
            >
              <Icon name="refresh" size={16} color={colors.primary} style={{ marginRight: 6 }} />
              <Text style={styles.retryNowLinkText}>Retry {failedCount} failed item(s) now</Text>
            </TouchableOpacity>
          )}

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
                <Animated.View style={{ marginRight: 8, transform: [{ rotate: spin }] }}>
                  <Icon name="sync" size={20} color="#FFF" />
                </Animated.View>
                <Text style={styles.syncButtonText}>Syncing Data...</Text>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Icon name={isOnline ? 'sync' : 'wifi-off'} size={20} color="#FFF" style={{ marginRight: 8 }} />
                <Text style={styles.syncButtonText}>
                  {isOnline ? 'Sync Now' : 'No Connection'}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Info */}
          <View style={styles.infoCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
              <Icon name="information-outline" size={20} color={colors.textPrimary} style={{ marginRight: 8 }} />
              <Text style={styles.infoTitle}>How Sync Works</Text>
            </View>
            <Text style={styles.infoText}>• Surveys are saved locally when offline</Text>
            <Text style={styles.infoText}>• Auto-sync triggers when internet is available</Text>
            <Text style={styles.infoText}>• Failed uploads retry automatically with increasing delays</Text>
            <Text style={styles.infoText}>• Items that fail 5 times need a manual retry, shown above</Text>
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
  statusIconContainer: {
    marginBottom: spacing.xs,
  },
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
  deadLetterCard: {
    backgroundColor: colors.errorBg, borderRadius: borderRadius.md,
    padding: spacing.xl, marginBottom: spacing.xl, borderWidth: 1, borderColor: colors.error,
  },
  deadLetterTitle: { ...typography.body, fontWeight: '700', color: colors.error },
  deadLetterText: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.md, lineHeight: 20 },
  retryButton: {
    backgroundColor: colors.error, borderRadius: borderRadius.md,
    padding: spacing.md, alignItems: 'center',
  },
  retryButtonText: { ...typography.button, color: '#FFF', fontSize: 14 },
  retryNowLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xl, padding: spacing.sm,
  },
  retryNowLinkText: { ...typography.bodySmall, color: colors.primary, fontWeight: '600' },
  infoCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.xl, borderWidth: 1, borderColor: colors.border,
  },
  infoTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.md },
  infoText: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.xs, lineHeight: 20 },
});