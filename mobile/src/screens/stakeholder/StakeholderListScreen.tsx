import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { stakeholderService } from '../../services/api';
import { colors, spacing, borderRadius, typography } from '../../theme';

const STATUS_COLORS: Record<string, string> = {
  PENDING: colors.statusPending,
  IN_PROGRESS: colors.statusInProgress,
  IN_REVIEW: colors.statusInReview,
  COMPLETED: colors.statusCompleted,
};

export default function StakeholderListScreen({ navigation }: any) {
  const { user } = useSelector((state: RootState) => state.auth);
  const [stakeholders, setStakeholders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const loadStakeholders = async (p = 1) => {
    setLoading(true);
    try {
      const res = await stakeholderService.search({ page: p, limit: 20 });
      const data = res.data.data;
      if (p === 1) {
        setStakeholders(data.stakeholders);
      } else {
        setStakeholders(prev => [...prev, ...data.stakeholders]);
      }
      setHasMore(data.pagination.hasMore);
      setPage(p);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => { loadStakeholders(); }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Stakeholders</Text>
        <Text style={styles.count}>{stakeholders.length} loaded</Text>
      </View>

      <FlatList
        data={stakeholders}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('StakeholderDetail', { stakeholderId: item.id })}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.orgName} numberOfLines={1}>
                {item.companyNameStandardized || 'Unknown Organization'}
              </Text>
              <View style={[styles.badge, { backgroundColor: STATUS_COLORS[item.status] || colors.statusPending }]}>
                <Text style={styles.badgeText}>{item.status?.replace('_', ' ')}</Text>
              </View>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.meta}>📍 {item.district || '—'}</Text>
              <Text style={styles.meta}>🏙 {item.city || '—'}</Text>
              <Text style={styles.meta}>📮 {item.pinCode || '—'}</Text>
            </View>
          </TouchableOpacity>
        )}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading && page === 1} onRefresh={() => loadStakeholders(1)} tintColor={colors.primary} />}
        onEndReached={() => hasMore && !loading && loadStakeholders(page + 1)}
        onEndReachedThreshold={0.3}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.xl },
  title: { ...typography.h2, color: colors.textPrimary },
  count: { ...typography.bodySmall, color: colors.textMuted },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 100 },
  card: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  orgName: { ...typography.body, fontWeight: '600', color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  badge: { borderRadius: borderRadius.full, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: '#FFF', fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  metaRow: { flexDirection: 'row', gap: spacing.lg },
  meta: { ...typography.bodySmall, color: colors.textSecondary },
});
