import React, { useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Alert } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import { setStats, setLoading } from '../../store/slices/dashboardSlice';
import { logout } from '../../store/slices/authSlice';
import { dashboardService } from '../../services/api';
import { syncQueueDao } from '../../database';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';

export default function DashboardScreen({ navigation }: any) {
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useSelector((state: RootState) => state.auth);
  const { stats, isLoading } = useSelector((state: RootState) => state.dashboard);
  const { lastSyncTime, pendingCount, failedCount } = useSelector((state: RootState) => state.sync);

  const loadStats = useCallback(async () => {
    dispatch(setLoading(true));
    try {
      const res = await dashboardService.getStats();
      dispatch(setStats(res.data.data.stakeholders));
    } catch (e) {
      // Use cached stats if offline
    }
    dispatch(setLoading(false));
  }, [dispatch]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Logout', style: 'destructive', onPress: () => dispatch(logout()) }
      ]
    );
  };

  const statCards = [
    { label: 'Completed', value: stats.completed, color: colors.success, icon: '✅' },
    { label: 'Pending', value: stats.pending, color: colors.statusPending, icon: '⏳' },
    { label: 'In Progress', value: stats.inProgress, color: colors.info, icon: '🔄' },
    { label: 'In Review', value: stats.inReview, color: colors.warning, icon: '🔍' },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={loadStats} tintColor={colors.primary} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.userName}>{user?.name}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.name?.[0] || 'U'}</Text>
          </View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
            <Text style={{ fontSize: 20 }}>🚪</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Districts */}
      <View style={styles.districtBar}>
        <Text style={styles.districtLabel}>Assigned Districts:</Text>
        <View style={styles.districtTags}>
          {user?.districts?.map((d: any) => (
            <View key={d.id} style={styles.districtTag}>
              <Text style={styles.districtTagText}>{d.name}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Stat Cards */}
      <Text style={styles.sectionTitle}>Stakeholder Overview</Text>
      <View style={styles.statsGrid}>
        {statCards.map((card) => (
          <View key={card.label} style={[styles.statCard, { borderLeftColor: card.color }]}>
            <Text style={styles.statIcon}>{card.icon}</Text>
            <Text style={styles.statValue}>{card.value.toLocaleString()}</Text>
            <Text style={styles.statLabel}>{card.label}</Text>
          </View>
        ))}
      </View>

      {/* Sync Status */}
      <Text style={styles.sectionTitle}>Sync Status</Text>
      <View style={styles.syncCard}>
        <View style={styles.syncRow}>
          <Text style={styles.syncLabel}>Last Sync</Text>
          <Text style={styles.syncValue}>
            {lastSyncTime ? new Date(lastSyncTime).toLocaleString() : 'Never'}
          </Text>
        </View>
        <View style={styles.syncDivider} />
        <View style={styles.syncRow}>
          <Text style={styles.syncLabel}>Pending Uploads</Text>
          <View style={[styles.syncBadge, { backgroundColor: pendingCount > 0 ? colors.warningBg : colors.successBg }]}>
            <Text style={[styles.syncBadgeText, { color: pendingCount > 0 ? colors.warning : colors.success }]}>
              {pendingCount}
            </Text>
          </View>
        </View>
        <View style={styles.syncDivider} />
        <View style={styles.syncRow}>
          <Text style={styles.syncLabel}>Failed Uploads</Text>
          <View style={[styles.syncBadge, { backgroundColor: failedCount > 0 ? colors.errorBg : colors.successBg }]}>
            <Text style={[styles.syncBadgeText, { color: failedCount > 0 ? colors.error : colors.success }]}>
              {failedCount}
            </Text>
          </View>
        </View>
      </View>

      {/* Quick Actions */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('Search')}
        >
          <Text style={styles.actionIcon}>🔍</Text>
          <Text style={styles.actionText}>Search</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('SyncTab')}
        >
          <Text style={styles.actionIcon}>🔄</Text>
          <Text style={styles.actionText}>Sync Now</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { padding: spacing.xl },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  greeting: { ...typography.bodySmall, color: colors.textSecondary },
  userName: { ...typography.h2, color: colors.textPrimary },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { color: '#FFF', fontSize: 20, fontWeight: '700' },
  logoutBtn: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.bgCard, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  districtBar: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.lg, marginBottom: spacing.xxl, borderWidth: 1, borderColor: colors.border,
  },
  districtLabel: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm },
  districtTags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  districtTag: {
    backgroundColor: colors.primaryBg, borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderWidth: 1, borderColor: 'rgba(255,107,53,0.2)',
  },
  districtTagText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  sectionTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.lg },
  statsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.xxxl,
  },
  statCard: {
    flex: 1, minWidth: '45%', backgroundColor: colors.bgCard,
    borderRadius: borderRadius.md, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3,
    ...shadows.card,
  },
  statIcon: { fontSize: 24, marginBottom: spacing.sm },
  statValue: { ...typography.stat, color: colors.textPrimary },
  statLabel: { ...typography.caption, color: colors.textMuted },
  syncCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.xl, borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.xxxl,
  },
  syncRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.md,
  },
  syncLabel: { ...typography.body, color: colors.textSecondary },
  syncValue: { ...typography.bodySmall, color: colors.textPrimary, fontWeight: '600' },
  syncDivider: { height: 1, backgroundColor: colors.border },
  syncBadge: { borderRadius: borderRadius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  syncBadgeText: { fontSize: 13, fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: spacing.md },
  actionButton: {
    flex: 1, backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.xl, alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  },
  actionIcon: { fontSize: 28, marginBottom: spacing.sm },
  actionText: { ...typography.label, color: colors.textPrimary },
});
