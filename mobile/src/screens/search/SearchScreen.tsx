import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, Modal,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import { setSearchResults, appendSearchResults, setSearching } from '../../store/slices/stakeholderSlice';
import { stakeholderService } from '../../services/api';
import { stakeholderDao } from '../../database';
import NetInfo from '@react-native-community/netinfo';
import { colors, spacing, borderRadius, typography } from '../../theme';

const STATUS_COLORS: Record<string, string> = {
  PENDING: colors.statusPending,
  IN_PROGRESS: colors.statusInProgress,
  IN_REVIEW: colors.statusInReview,
  COMPLETED: colors.statusCompleted,
};

export default function SearchScreen({ navigation }: any) {
  const dispatch = useDispatch<AppDispatch>();
  const { searchResults, searchPagination, isSearching } = useSelector((state: RootState) => state.stakeholder);
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const debounceRef = useRef<NodeJS.Timeout>();

  const search = useCallback(async (searchQuery: string, activeFilters: Record<string, string>, page = 1) => {
    dispatch(setSearching(true));

    try {
      const netState = await NetInfo.fetch();
      const isOnline = netState.isConnected;

      if (isOnline) {
        // Online: search via API (PostgreSQL + trigram indexes)
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
        // Offline: search SQLite
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
      dispatch(setSearching(false));
    }
  }, [dispatch]);

  const handleSearch = (text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      search(text, filters);
    }, 300);
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

  const renderStakeholder = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.resultCard}
      onPress={() => navigation.navigate('StakeholderDetail', { stakeholderId: item.id })}
      activeOpacity={0.7}
    >
      <View style={styles.resultHeader}>
        <Text style={styles.orgName} numberOfLines={1}>
          {item.companyNameStandardized || item.company_name_standardized || 'Unknown'}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] || colors.statusPending }]}>
          <Text style={styles.statusText}>{(item.status || 'PENDING').replace('_', ' ')}</Text>
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
  );

  return (
    <View style={styles.container}>
      {/* Search Bar */}
      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search stakeholders..."
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={handleSearch}
            returnKeyType="search"
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
        ListEmptyComponent={
          !isSearching ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyTitle}>Search Stakeholders</Text>
              <Text style={styles.emptyText}>Enter a name, organization, or use filters to find stakeholders</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          isSearching ? <ActivityIndicator color={colors.primary} style={{ padding: 20 }} /> : null
        }
      />

      {/* Filter Modal */}
      <Modal visible={showFilters} animationType="slide" transparent>
        <View style={styles.filterOverlay}>
          <View style={styles.filterModal}>
            <Text style={styles.filterTitle}>Search Filters</Text>

            {[
              { key: 'district', label: 'District', placeholder: 'e.g., PUNE' },
              { key: 'state', label: 'State', placeholder: 'e.g., Maharashtra' },
              { key: 'pinCode', label: 'PIN Code', placeholder: 'e.g., 411001' },
              { key: 'category', label: 'Category', placeholder: 'e.g., Hotels & Resorts' },
              { key: 'nicCode', label: 'NIC Code', placeholder: 'e.g., 55101' },
              { key: 'gst', label: 'GST Number', placeholder: 'GST Number' },
              { key: 'status', label: 'Status', placeholder: 'PENDING / IN_PROGRESS / COMPLETED' },
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
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  searchSection: { flexDirection: 'row', padding: spacing.lg, gap: spacing.sm },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.border,
  },
  searchIcon: { fontSize: 16, marginRight: spacing.sm },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15, paddingVertical: 12 },
  clearIcon: { color: colors.textMuted, fontSize: 16, padding: spacing.sm },
  filterButton: {
    width: 48, height: 48, borderRadius: borderRadius.md,
    backgroundColor: colors.bgCard, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  filterButtonActive: { borderColor: colors.primary, backgroundColor: colors.primaryBg },
  filterIcon: { fontSize: 20 },
  resultCount: { ...typography.caption, color: colors.textMuted, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: 100 },
  resultCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.lg, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  orgName: { ...typography.body, fontWeight: '600', color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  statusBadge: { borderRadius: borderRadius.full, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { color: '#FFF', fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  resultMeta: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.xs },
  metaText: { ...typography.bodySmall, color: colors.textSecondary },
  categoryText: { ...typography.bodySmall, color: colors.textMuted, marginTop: spacing.xs },
  emptyState: { alignItems: 'center', paddingVertical: spacing.huge },
  emptyIcon: { fontSize: 48, marginBottom: spacing.lg },
  emptyTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },
  emptyText: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.xxxl },
  filterOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  filterModal: {
    backgroundColor: colors.bgCard, borderTopLeftRadius: borderRadius.xl, borderTopRightRadius: borderRadius.xl,
    padding: spacing.xxl, maxHeight: '80%',
  },
  filterTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.xxl },
  filterGroup: { marginBottom: spacing.lg },
  filterLabel: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.xs },
  filterInput: {
    backgroundColor: colors.bgInput, borderWidth: 1, borderColor: colors.border,
    borderRadius: borderRadius.sm, padding: spacing.md, color: colors.textPrimary, fontSize: 14,
  },
  filterActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  clearButton: { flex: 1, padding: 14, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  clearButtonText: { color: colors.textSecondary, fontWeight: '600' },
  applyButton: { flex: 1, padding: 14, borderRadius: borderRadius.md, backgroundColor: colors.primary, alignItems: 'center' },
  applyButtonText: { color: '#FFF', fontWeight: '700' },
});
