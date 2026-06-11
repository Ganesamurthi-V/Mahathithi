import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, Modal, Animated, Easing, Keyboard
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import { setSearchResults, appendSearchResults, setSearching } from '../../store/slices/stakeholderSlice';
import { stakeholderService } from '../../services/api';
import { stakeholderDao } from '../../database';
import NetInfo from '@react-native-community/netinfo';
import { colors, spacing, borderRadius, typography, shadows, animations, iconSizes } from '../../theme';
import { moderateScale } from '../../theme/responsive';

const STATUS_COLORS: Record<string, string> = {
  OPEN: colors.statusPending,
  CLOSED: colors.statusCompleted,
};

const StakeholderCard = React.memo(({ item, onPress }: { item: any, onPress: () => void }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => Animated.spring(scaleAnim, { toValue: 0.98, useNativeDriver: true }).start();
  const handlePressOut = () => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start();

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[styles.resultCard, { borderLeftColor: STATUS_COLORS[item.status] || colors.statusPending }]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.9}
      >
        <View style={styles.resultHeader}>
          <Text style={styles.orgName} numberOfLines={1}>
            {item.companyNameStandardized || item.company_name_standardized || 'Unknown'}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] || colors.statusPending }]}>
            <Text style={styles.statusText}>{(item.status || 'OPEN').replace('_', ' ')}</Text>
          </View>
        </View>
        <View style={styles.resultMeta}>
          <Text style={styles.metaText}>📍 {item.district || item.city || '—'}</Text>
          <Text style={styles.metaText}>🏙 {item.city || '—'}</Text>
          <Text style={styles.metaText}>📮 {item.pinCode || item.pin_code || '—'}</Text>
        </View>
        {(item.category || item.nicDescription || item.nic_description) && (
          <Text style={styles.categoryText}>
            {item.category} • {item.nicDescription || item.nic_description || ''}
          </Text>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
});

export default function SearchScreen({ navigation }: any) {
  const dispatch = useDispatch<AppDispatch>();
  const { searchResults, searchPagination, isSearching } = useSelector((state: RootState) => state.stakeholder);
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const filterSlideAnim = useRef(new Animated.Value(500)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  useEffect(() => {
    if (showFilters) {
      Animated.spring(filterSlideAnim, { toValue: 0, useNativeDriver: true, ...animations.spring.bouncy }).start();
    } else {
      Animated.timing(filterSlideAnim, { toValue: 500, duration: 250, useNativeDriver: true }).start();
    }
  }, [showFilters]);

  const search = useCallback(async (searchQuery: string, activeFilters: Record<string, string>, page = 1) => {
    dispatch(setSearching(true));

    try {
      const netState = await NetInfo.fetch();
      const isOnline = netState.isConnected;

      if (isOnline) {
        const params: Record<string, any> = { page, limit: 20 };
        if (searchQuery) params.name = searchQuery;
        Object.entries(activeFilters).forEach(([k, v]) => { if (v) params[k] = v; });

        const res = await stakeholderService.search(params);
        const { stakeholders, pagination } = res.data.data;

        if (page === 1) {
          dispatch(setSearchResults({ stakeholders, pagination }));
        } else {
          dispatch(appendSearchResults({ stakeholders, pagination }));
        }
      } else {
        const offlineFilters: Record<string, string> = { ...activeFilters };
        if (searchQuery) offlineFilters.name = searchQuery;

        const results = await stakeholderDao.search(offlineFilters, page);
        const fakePageInfo = { page, total: results.length, hasMore: results.length === 20 };

        if (page === 1) {
          dispatch(setSearchResults({ stakeholders: results, pagination: fakePageInfo }));
        } else {
          dispatch(appendSearchResults({ stakeholders: results, pagination: fakePageInfo }));
        }
      }
    } catch (e) {
      console.error('Search error:', e);
    } finally {
      dispatch(setSearching(false));
    }
  }, [dispatch]);

  const handleSearch = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      search(text, filters);
    }, 400); // Increased debounce for better performance
  };

  const applyFilters = () => {
    setShowFilters(false);
    search(query, filters);
  };

  const loadMore = () => {
    if (searchPagination.hasMore && !isSearching) {
      search(query, filters, searchPagination.page + 1);
    }
  };

  const renderStakeholder = useCallback(({ item }: { item: any }) => (
    <StakeholderCard 
      item={item} 
      onPress={() => navigation.navigate('StakeholderDetail', { stakeholderId: item.id })} 
    />
  ), [navigation]);

  return (
    <View style={styles.container}>
      {/* Search Bar */}
      <View style={styles.searchSection}>
        <View style={[styles.searchBar, isSearchFocused && styles.searchBarFocused]}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search stakeholders..."
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={handleSearch}
            returnKeyType="search"
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => { setQuery(''); search('', filters); }}>
              <Text style={styles.clearIcon}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[styles.filterButton, Object.values(filters).some(v => v) && styles.filterButtonActive]}
          onPress={() => setShowFilters(true)}
        >
          <Text style={styles.filterIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* Results count */}
      {searchResults.length > 0 && (
        <Text style={styles.resultCount}>
          {searchPagination.total?.toLocaleString() || searchResults.length} results found
        </Text>
      )}

      {/* Results */}
      <FlatList
        data={searchResults}
        renderItem={renderStakeholder}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={5}
        getItemLayout={(data, index) => (
          {length: moderateScale(120), offset: moderateScale(120) * index, index} // Estimate item height
        )}
        ListEmptyComponent={
          !isSearching ? (
            <View style={styles.emptyState}>
              <Animated.Text style={[styles.emptyIcon, { transform: [{ scale: pulseAnim }] }]}>🔍</Animated.Text>
              <Text style={styles.emptyTitle}>Search Stakeholders</Text>
              <Text style={styles.emptyText}>Enter a name, organization, or use filters to find stakeholders</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          isSearching ? <ActivityIndicator color={colors.primary} style={{ padding: spacing.xl }} /> : null
        }
      />

      {/* Filter Modal */}
      <Modal visible={showFilters} animationType="fade" transparent>
        <TouchableOpacity style={styles.filterOverlay} activeOpacity={1} onPress={() => setShowFilters(false)}>
          <Animated.View style={[styles.filterModal, { transform: [{ translateY: filterSlideAnim }] }]}>
            <TouchableOpacity activeOpacity={1}>
              <Text style={styles.filterTitle}>Search Filters</Text>

              {[
                { key: 'district', label: 'District', placeholder: 'e.g., PUNE' },
                { key: 'taluka', label: 'Taluka', placeholder: 'e.g., Haveli' },
                { key: 'city', label: 'Village / City', placeholder: 'e.g., Lonavala' },
                { key: 'state', label: 'State', placeholder: 'e.g., Maharashtra' },
                { key: 'pinCode', label: 'PIN Code', placeholder: 'e.g., 411001' },
                { key: 'category', label: 'Category', placeholder: 'e.g., Hotels & Resorts' },
                { key: 'nicCode', label: 'NIC Code', placeholder: 'e.g., 55101' },
                { key: 'gst', label: 'GST Number', placeholder: 'GST Number' },
              ].map((f) => (
                <View key={f.key} style={styles.filterGroup}>
                  <Text style={styles.filterLabel}>{f.label}</Text>
                  <TextInput
                    style={styles.filterInput}
                    placeholder={f.placeholder}
                    placeholderTextColor={colors.textMuted}
                    value={filters[f.key] || ''}
                    onChangeText={(v) => setFilters({ ...filters, [f.key]: v })}
                  />
                </View>
              ))}

              <View style={styles.filterActions}>
                <TouchableOpacity style={styles.clearButton} onPress={() => { setFilters({}); setShowFilters(false); search(query, {}); }}>
                  <Text style={styles.clearButtonText}>Clear All</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.applyButton} onPress={applyFilters}>
                  <Text style={styles.applyButtonText}>Apply Filters</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </Animated.View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  searchSection: { flexDirection: 'row', padding: spacing.lg, gap: spacing.sm },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bgInput, borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.border,
  },
  searchBarFocused: {
    borderColor: colors.primary,
    backgroundColor: colors.bgCard,
    ...shadows.glow,
  },
  searchIcon: { fontSize: iconSizes.sm, marginRight: spacing.sm },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: moderateScale(16), paddingVertical: moderateScale(14) },
  clearIcon: { color: colors.textMuted, fontSize: iconSizes.sm, padding: spacing.sm },
  filterButton: {
    width: moderateScale(52), height: moderateScale(52), borderRadius: borderRadius.md,
    backgroundColor: colors.bgCard, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  filterButtonActive: { borderColor: colors.primary, backgroundColor: colors.primaryBg, ...shadows.glow },
  filterIcon: { fontSize: moderateScale(20) },
  resultCount: { ...typography.caption, color: colors.textMuted, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: moderateScale(100) },
  resultCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.lg, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border, borderLeftWidth: moderateScale(4),
    ...shadows.card,
  },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  orgName: { ...typography.body, fontWeight: '600', color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  statusBadge: { borderRadius: borderRadius.full, paddingHorizontal: moderateScale(10), paddingVertical: moderateScale(4) },
  statusText: { color: '#FFF', fontSize: moderateScale(10), fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  resultMeta: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.xs },
  metaText: { ...typography.bodySmall, color: colors.textSecondary },
  categoryText: { ...typography.bodySmall, color: colors.textMuted, marginTop: spacing.xs },
  emptyState: { alignItems: 'center', paddingVertical: spacing.huge, marginTop: moderateScale(40) },
  emptyIcon: { fontSize: moderateScale(56), marginBottom: spacing.lg },
  emptyTitle: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.sm },
  emptyText: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.xxxl, lineHeight: moderateScale(20) },
  filterOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  filterModal: {
    backgroundColor: colors.bgCard, borderTopLeftRadius: borderRadius.xl, borderTopRightRadius: borderRadius.xl,
    padding: spacing.xxl, maxHeight: '85%',
    ...shadows.elevated,
  },
  filterTitle: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.xxl },
  filterGroup: { marginBottom: spacing.lg },
  filterLabel: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.xs },
  filterInput: {
    backgroundColor: colors.bgInput, borderWidth: 1, borderColor: colors.border,
    borderRadius: borderRadius.sm, padding: spacing.md, color: colors.textPrimary, fontSize: moderateScale(15),
  },
  filterActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  clearButton: { flex: 1, padding: spacing.lg, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  clearButtonText: { color: colors.textSecondary, fontWeight: '600', fontSize: moderateScale(16) },
  applyButton: { flex: 1, padding: spacing.lg, borderRadius: borderRadius.md, backgroundColor: colors.primary, alignItems: 'center', ...shadows.elevated },
  applyButtonText: { color: '#FFF', fontWeight: '700', fontSize: moderateScale(16) },
});
