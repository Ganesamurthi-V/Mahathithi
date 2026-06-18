import React, { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Alert, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import { setStats, setLoading } from '../../store/slices/dashboardSlice';
import { logout } from '../../store/slices/authSlice';
import { dashboardService } from '../../services/api';
import { colors, spacing, borderRadius, typography, shadows, iconSizes } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const StatCard = React.memo(({ card, index }: { card: any, index: number }) => {
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 400,
        delay: index * 100,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 40,
        delay: index * 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, [index, opacityAnim, scaleAnim]);

  return (
    <Animated.View style={[
      styles.statCard, 
      { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }
    ]}>
      <View style={[styles.statIconWrapper, { backgroundColor: card.color + '20' }]}>
        <Icon name={card.icon} size={iconSizes.md} color={card.color} />
      </View>
      <Text style={styles.statValue}>{card.value.toLocaleString()}</Text>
      <Text style={styles.statLabel}>{card.label}</Text>
    </Animated.View>
  );
});

const ActionButton = React.memo(({ icon, text, onPress }: { icon: string, text: string, onPress: () => void }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.95, useNativeDriver: true }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start();
  };

  return (
    <Animated.View style={{ flex: 1, transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={styles.actionButton}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.9}
      >
        <View style={styles.actionIconContainer}>
          <Icon name={icon} size={iconSizes.md} color={colors.primary} />
        </View>
        <Text style={styles.actionText}>{text}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
});

export default function DashboardScreen({ navigation }: any) {
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useSelector((state: RootState) => state.auth);
  const { stats, isLoading } = useSelector((state: RootState) => state.dashboard);
  const { lastSyncTime, pendingCount, failedCount } = useSelector((state: RootState) => state.sync);

  const [greeting, setGreeting] = useState('Welcome back,');

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Good morning,');
    else if (hour < 18) setGreeting('Good afternoon,');
    else setGreeting('Good evening,');
  }, []);

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

  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, [loadStats])
  );

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

  const statCards = useMemo(() => [
    { label: 'Completed', value: stats.completed, color: colors.success, icon: 'check-circle-outline' },
    { label: 'Open Tasks', value: stats.open, color: colors.warning, icon: 'clipboard-list-outline' },
  ], [stats]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={loadStats} tintColor={colors.primary} />}
      >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTextContainer}>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.userName}>{user?.name}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.name?.[0] || 'U'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
            <Icon name="logout" size={moderateScale(20)} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Districts */}
      <View style={styles.districtBar}>
        <Text style={styles.districtLabel}>Assigned Districts:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.districtTags}>
          {user?.districts?.map((d: any) => (
            <View key={d.id} style={styles.districtTag}>
              <Icon name="map-marker-outline" size={moderateScale(14)} color={colors.primary} style={{ marginRight: 4 }} />
              <Text style={styles.districtTagText}>{d.name}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      {/* Stat Cards */}
      <Text style={styles.sectionTitle}>Overview</Text>
      <View style={styles.statsGrid}>
        {statCards.map((card, index) => (
          <StatCard key={card.label} card={card} index={index} />
        ))}
      </View>

      {/* Sync Status */}
      <Text style={styles.sectionTitle}>Sync Status</Text>
      <View style={styles.syncCard}>
        <View style={styles.syncRow}>
          <View style={styles.syncLabelContainer}>
            <Icon name="clock-outline" size={moderateScale(20)} color={colors.textMuted} />
            <Text style={styles.syncLabel}>Last Sync</Text>
          </View>
          <Text style={styles.syncValue}>
            {lastSyncTime ? new Date(lastSyncTime).toLocaleString() : 'Never'}
          </Text>
        </View>
        <View style={styles.syncDivider} />
        <View style={styles.syncRow}>
          <View style={styles.syncLabelContainer}>
            <Icon name="cloud-upload-outline" size={moderateScale(20)} color={colors.textMuted} />
            <Text style={styles.syncLabel}>Pending Uploads</Text>
          </View>
          <View style={[styles.syncBadge, { backgroundColor: pendingCount > 0 ? colors.warningBg : colors.successBg }]}>
            <Text style={[styles.syncBadgeText, { color: pendingCount > 0 ? colors.warning : colors.success }]}>
              {pendingCount}
            </Text>
          </View>
        </View>
        {failedCount > 0 && (
          <>
            <View style={styles.syncDivider} />
            <View style={styles.syncRow}>
              <View style={styles.syncLabelContainer}>
                <Icon name="alert-circle-outline" size={moderateScale(20)} color={colors.error} />
                <Text style={[styles.syncLabel, { color: colors.error }]}>Failed Uploads</Text>
              </View>
              <View style={[styles.syncBadge, { backgroundColor: colors.errorBg }]}>
                <Text style={[styles.syncBadgeText, { color: colors.error }]}>
                  {failedCount}
                </Text>
              </View>
            </View>
          </>
        )}
      </View>

      {/* Quick Actions */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsRow}>
        <ActionButton icon="magnify" text="Search" onPress={() => navigation.navigate('Search')} />
        <ActionButton icon="sync" text="Sync Now" onPress={() => navigation.navigate('SyncTab')} />
      </View>
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { padding: spacing.xl, paddingBottom: moderateScale(40) },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: spacing.xxl, paddingTop: spacing.md,
  },
  headerTextContainer: { flex: 1, paddingRight: spacing.md },
  greeting: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.xs },
  userName: { ...typography.h2, color: colors.primary, flexWrap: 'wrap' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: moderateScale(50), height: moderateScale(50), borderRadius: moderateScale(25),
    backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center',
    ...shadows.glow,
  },
  avatarText: { color: '#FFF', fontSize: moderateScale(22), fontWeight: '700' },
  logoutBtn: {
    width: moderateScale(40), height: moderateScale(40), borderRadius: moderateScale(20),
    backgroundColor: colors.bgCard, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  districtBar: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.lg,
    padding: spacing.lg, marginBottom: spacing.xxl, borderWidth: 1, borderColor: colors.border,
    ...shadows.card,
  },
  districtLabel: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.md },
  districtTags: { flexDirection: 'row', alignItems: 'center' },
  districtTag: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.primaryBg, borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: 1, borderColor: 'rgba(255,107,53,0.3)',
    marginRight: spacing.sm,
  },
  districtTagText: { color: colors.primary, fontSize: moderateScale(13), fontWeight: '600' },
  sectionTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.lg, letterSpacing: 0.5 },
  statsGrid: {
    flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xxxl,
  },
  statCard: {
    width: '48%', backgroundColor: colors.bgCard,
    borderRadius: borderRadius.xl, padding: spacing.xl,
    borderWidth: 1, borderColor: colors.border,
    ...shadows.elevated,
  },
  statIconWrapper: {
    width: moderateScale(48), height: moderateScale(48), borderRadius: moderateScale(24),
    justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md,
  },
  statValue: { ...typography.stat, color: colors.textPrimary, marginBottom: spacing.xs },
  statLabel: { ...typography.bodySmall, color: colors.textSecondary, fontWeight: '500' },
  syncCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.xl,
    padding: spacing.xl, borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.xxxl,
    ...shadows.elevated,
  },
  syncRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  syncLabelContainer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  syncLabel: { ...typography.body, color: colors.textSecondary, fontWeight: '500' },
  syncValue: { ...typography.bodySmall, color: colors.textPrimary, fontWeight: '600' },
  syncDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  syncBadge: { borderRadius: borderRadius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  syncBadgeText: { fontSize: moderateScale(13), fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: spacing.lg },
  actionButton: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.xl,
    padding: spacing.xl, alignItems: 'center', borderWidth: 1, borderColor: colors.border,
    ...shadows.elevated,
  },
  actionIconContainer: {
    width: moderateScale(60), height: moderateScale(60), borderRadius: moderateScale(30), backgroundColor: colors.primaryBg,
    justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md,
  },
  actionText: { ...typography.label, color: colors.textPrimary },
});
