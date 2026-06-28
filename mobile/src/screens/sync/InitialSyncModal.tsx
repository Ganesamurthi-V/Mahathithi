import React from 'react';
import { Modal, View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, ProgressBarAndroid } from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import { runInitialSync } from '../../store/slices/syncThunks';
import { colors, typography, shadows, spacing } from '../../theme';
import { moderateScale, verticalScale } from '../../theme/responsive';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export default function InitialSyncModal() {
  const dispatch = useDispatch<AppDispatch>();
  const { isInitialSyncing, initialSyncProgress, initialSyncMessage, initialSyncError } = useSelector((state: RootState) => state.sync);

  // If the initial sync is not happening, don't show the modal
  if (!isInitialSyncing) return null;

  const handleRetry = () => {
    dispatch(runInitialSync() as any);
  };

  return (
    <Modal transparent animationType="fade" visible={isInitialSyncing}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Icon 
            name={initialSyncError ? "alert-circle" : "cloud-download"} 
            size={moderateScale(48)} 
            color={initialSyncError ? colors.error : colors.primary} 
          />
          
          <Text style={styles.title}>
            {initialSyncError ? "Sync Failed" : "Initial Setup"}
          </Text>
          
          <Text style={styles.message}>
            {initialSyncError || initialSyncMessage || "Downloading your district data..."}
          </Text>

          {!initialSyncError && (
            <View style={styles.progressContainer}>
              <View style={styles.progressBarBackground}>
                <View style={[styles.progressBarFill, { width: `${initialSyncProgress}%` }]} />
              </View>
              <Text style={styles.progressText}>{initialSyncProgress}%</Text>
            </View>
          )}

          {initialSyncError && (
            <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
              <Text style={styles.retryText}>Retry Download</Text>
            </TouchableOpacity>
          )}

          {!initialSyncError && (
            <Text style={styles.warningText}>
              Please do not close the app. This might take 3-5 minutes.
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: moderateScale(16),
    padding: spacing.xl,
    width: '100%',
    alignItems: 'center',
    ...shadows.elevated,
  },
  title: {
    ...typography.h2,
    color: colors.textPrimary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  progressContainer: {
    width: '100%',
    alignItems: 'center',
  },
  progressBarBackground: {
    width: '100%',
    height: verticalScale(8),
    backgroundColor: colors.border,
    borderRadius: moderateScale(4),
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  progressText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '700',
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: moderateScale(8),
    marginTop: spacing.sm,
  },
  retryText: {
    ...typography.button,
    color: '#fff',
  },
  warningText: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xl,
    textAlign: 'center',
  },
});
