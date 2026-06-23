import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Animated, Easing } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { stakeholderService } from '../../services/api';
import { stakeholderDao } from '../../database';
import NetInfo from '@react-native-community/netinfo';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';

const STATUS_COLORS: Record<string, string> = {
  OPEN: colors.statusPending,
  PARTIAL_COMPLETED: colors.warning,
  CLOSED: colors.statusCompleted,
};

const SkeletonCard = () => {
  const pulseAnim = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.5, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <Animated.View style={[styles.card, { opacity: pulseAnim }]}>
      <View style={styles.cardHeader}>
        <View style={styles.skeletonTextLarge} />
        <View style={styles.skeletonBadge} />
      </View>
      <View style={styles.metaRow}>
        <View style={styles.skeletonTextSmall} />
        <View style={styles.skeletonTextSmall} />
      </View>
    </Animated.View>
  );
};

const StakeholderCard = React.memo(({ item, index, onPress }: { item: any, index: number, onPress: () => void }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        delay: Math.min(index * 50, 500),
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        delay: Math.min(index * 50, 500),
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
    ]).start();
  }, []);

  const handlePressIn = () => Animated.spring(scaleAnim, { toValue: 0.98, useNativeDriver: true }).start();
  const handlePressOut = () => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start();

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }, { scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: STATUS_COLORS[item.status] || colors.statusPending }]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.9}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.orgName} numberOfLines={1}>
            {item.companyNameStandardized || 'Unknown Organization'}
          </Text>
          <View style={[styles.badge, { backgroundColor: STATUS_COLORS[item.status] || colors.statusPending }]}>
            <Text style={styles.badgeText}>{(item.status || 'OPEN').replace('_', ' ')}</Text>
          </View>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.meta}><Icon name="map-marker" size={14} color={colors.textMuted} /> {item.district || '—'}</Text>
          <Text style={styles.meta}><Icon name="city" size={14} color={colors.textMuted} /> {item.city || '—'}</Text>
          <Text style={styles.meta}><Icon name="mailbox" size={14} color={colors.textMuted} /> {item.pinCode || '—'}</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
});

export default function StakeholderListScreen({ navigation }: any) {
  const { user } = useSelector((state: RootState) => state.auth);
  const [stakeholders, setStakeholders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const loadStakeholders = async (p = 1) => {
    if (p === 1) setInitialLoading(true);
    setLoading(true);
    try {
      const netState = await NetInfo.fetch();
      
      if (netState.isConnected) {
        const res = await stakeholderService.search({ page: p, limit: 20 });
        const data = res.data.data;
        if (p === 1) {
          setStakeholders(data.stakeholders);
        } else {
          setStakeholders(prev => [...prev, ...data.stakeholders]);
        }
        setHasMore(data.pagination.hasMore);
      } else {
        throw new Error('Offline'); // Trigger catch block to load from SQLite
      }
    } catch (e) {
      // Fallback to local SQLite database when offline or API fails
      const localData = await stakeholderDao.search({}, p);
      if (p === 1) {
        setStakeholders(localData);
      } else {
        setStakeholders(prev => [...prev, ...localData]);
      }
      setHasMore(localData.length === 20);
    } finally {
      setPage(p);
      setLoading(false);
      setInitialLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadStakeholders();
    }, [])
  );

  const renderItem = useCallback(({ item, index }: { item: any, index: number }) => (
    <StakeholderCard 
      item={item} 
      index={index}
      onPress={() => navigation.navigate('StakeholderDetail', { stakeholderId: item.id })} 
    />
  ), [navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Stakeholders</Text>
          {!initialLoading && (
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{stakeholders.length} items</Text>
            </View>
          )}
        </View>

        {initialLoading ? (
          <View style={styles.list}>
            {[1, 2, 3, 4, 5].map(i => <SkeletonCard key={i} />)}
          </View>
        ) : (
          <FlatList
            data={stakeholders}
            renderItem={renderItem}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={loading && page === 1} onRefresh={() => loadStakeholders(1)} tintColor={colors.primary} />}
            onEndReached={() => hasMore && !loading && loadStakeholders(page + 1)}
            onEndReachedThreshold={0.3}
            removeClippedSubviews={true}
            maxToRenderPerBatch={10}
            windowSize={5}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.xl },
  title: { ...typography.h2, color: colors.textPrimary },
  countBadge: { backgroundColor: colors.bgCard, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  countText: { ...typography.caption, color: colors.textSecondary },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 100 },
  card: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
    borderLeftWidth: 4,
    ...shadows.card,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  orgName: { ...typography.body, fontWeight: '600', color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  badge: { borderRadius: borderRadius.full, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: '#FFF', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  metaRow: { flexDirection: 'row', gap: spacing.lg },
  meta: { ...typography.bodySmall, color: colors.textSecondary },
  
  // Skeleton styles
  skeletonTextLarge: { width: '60%', height: 20, backgroundColor: colors.border, borderRadius: 4 },
  skeletonBadge: { width: 60, height: 20, backgroundColor: colors.border, borderRadius: 10 },
  skeletonTextSmall: { width: '30%', height: 14, backgroundColor: colors.border, borderRadius: 4 },
});
