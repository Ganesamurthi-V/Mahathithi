import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, TextInput,
  StyleSheet, ActivityIndicator, Animated, Modal, Keyboard
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import { setSearchResults, appendSearchResults, setSearching } from '../../store/slices/stakeholderSlice';
import { stakeholderService } from '../../services/api';
import { stakeholderDao } from '../../database';
import NetInfo from '@react-native-community/netinfo';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { moderateScale } from '../../theme/responsive';

const STATUS_COLORS: Record<string, string> = {
  OPEN: colors.statusPending,
  PARTIAL_COMPLETED: colors.warning,
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
          <Text style={styles.metaText}><Icon name="map-marker" size={14} color={colors.textMuted} /> {item.district || item.city || '—'}</Text>
          <Text style={styles.metaText}><Icon name="city" size={14} color={colors.textMuted} /> {item.city || '—'}</Text>
          <Text style={styles.metaText}><Icon name="mailbox" size={14} color={colors.textMuted} /> {item.pinCode || item.pin_code || '—'}</Text>
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

  // Two INDEPENDENT free-text filters. Either one alone, both together, or neither
  // — there is no ordering and no field is gated on another.
  //
  // This replaced a cascade (District picker -> City enabled -> PIN enabled) where
  // each field was disabled until the one above it was filled. That forced the
  // operator to pick a district before they could type a village, and a village
  // before a PIN — the exact step-by-step the request asks to remove. The local
  // search DAO already treats every filter as an optional, independent AND term, so
  // only the UI was imposing the order.
  //
  // `village` maps to the DAO's `city` filter, which matches city OR village, so a
  // single box covers both the way an enumerator thinks of a place name.
  const [name, setName] = useState<string>('');
  const [village, setVillage] = useState<string>('');
  const [pin, setPin] = useState<string>('');

  // Each field can be filled two ways: typed, or picked from a dropdown of the
  // values that actually exist in this enumerator's local data.
  //
  // The dropdown is the reason both lists are loaded up front. The field team is
  // large and not uniformly technical, and a typo in a place name silently
  // returns zero results with nothing to explain why — the operator cannot tell
  // "spelled it wrong" apart from "nothing here". Picking from a list of known
  // values makes an empty result impossible to reach by accident.
  //
  // Sourced from SQLite, not the server, so the pickers work with no signal and
  // only ever offer areas the operator has been assigned.
  const [placeOptions, setPlaceOptions] = useState<Array<{ value: string; count: number }>>([]);
  const [pinOptions, setPinOptions] = useState<Array<{ value: string; count: number }>>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);

  // Which dropdown is open, and the type-to-narrow text inside it. A district
  // can carry a few hundred PINs, so the sheet needs its own filter box to stay
  // usable — but typing there only narrows the list, it never becomes the filter.
  const [openPicker, setOpenPicker] = useState<null | 'place' | 'pin'>(null);
  const [pickerQuery, setPickerQuery] = useState('');

  // The filter panel folds away so the result list gets the full screen. It
  // collapses on its own once a value is committed (picked, or entered from the
  // keyboard), which is the point at which the operator stops caring about the
  // inputs and starts reading results.
  const [collapsed, setCollapsed] = useState(false);

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Refreshed on every focus rather than once on mount. This screen lives in a
  // bottom tab and stays mounted, so a mount-only load would keep serving the
  // option lists from whenever the app started — a batch synced mid-shift would
  // be searchable but invisible in the dropdowns until a restart.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const [places, pins] = await Promise.all([
            stakeholderDao.getAllPlaceNames().catch(() => []),
            stakeholderDao.getAllPinCodes().catch(() => []),
          ]);
          if (cancelled) return;
          setPlaceOptions(places);
          setPinOptions(pins);
        } finally {
          if (!cancelled) setOptionsLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }, [])
  );

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const search = useCallback(async (activeFilters: Record<string, string>, page = 1) => {
    dispatch(setSearching(true));

    try {
      // 1. Offline-First: always check the local SQLite cache first.
      //    This is the source of truth whenever it has an answer — fast,
      //    free, and works with zero connectivity.
      //
      //    PERF: the row fetch and the COUNT(*) used to run sequentially, so the
      //    results could not render until a count over the local stakeholder
      //    table had also finished. The count is only used for the "N results
      //    found" label, so it must never gate the list. It now runs in parallel
      //    and its own latency is hidden behind the fetch.
      const [localResults, totalCount] = await Promise.all([
        stakeholderDao.search(activeFilters, page),
        stakeholderDao.searchCount(activeFilters).catch(() => 0),
      ]);

      let finalResults = localResults;
      let pageInfo = { page, total: totalCount, hasMore: localResults.length === 20 };

      // 2. Only fall back to the network when SQLite came up empty for this
      //    page — either nothing has been synced for this area yet, or
      //    we've paged past what's cached locally.
      if (localResults.length === 0) {
        const netState = await NetInfo.fetch();
        if (netState.isConnected) {
          try {
            const res = await stakeholderService.search({ ...activeFilters, page, limit: 20 });
            const remote = res.data?.data;

            if (remote?.stakeholders?.length) {
              // Cache server results locally so this search (and any repeat
              // of it) is answered from SQLite next time, online or offline.
              await stakeholderDao.upsertMany(remote.stakeholders);

              finalResults = remote.stakeholders;
              const remotePage = remote.pagination?.page || page;
              const remoteLimit = remote.pagination?.limit || 20;
              // The server no longer returns an exact total on a FILTERED search —
              // the COUNT(*) cost ~7x the page query itself, so it was dropped.
              // `total` is therefore null here, and deriving hasMore from it would
              // be wrong: falling back to stakeholders.length gives 20, and
              // `1 * 20 < 20` is false, so "load more" would stop after page 1 even
              // though more rows exist.
              //
              // The server sends an authoritative hasMore instead, computed by
              // fetching one row beyond the page. Prefer it, and only fall back to
              // arithmetic when talking to an older backend that does not send it.
              const remoteTotal = remote.pagination?.total ?? null;
              pageInfo = {
                page: remotePage,
                // Only used for the "N results found" label.
                total: remoteTotal ?? remote.stakeholders.length,
                hasMore:
                  typeof remote.pagination?.hasMore === 'boolean'
                    ? remote.pagination.hasMore
                    : remoteTotal !== null
                      ? remotePage * remoteLimit < remoteTotal
                      : remote.stakeholders.length === remoteLimit,
              };
            }
          } catch (e) {
            // No connectivity, server error, etc. — fall back to whatever
            // SQLite gave us (i.e. an empty result), never throw to the UI.
            console.warn('Online search fallback failed:', e);
          }
        }
      }

      if (page === 1) {
        dispatch(setSearchResults({ stakeholders: finalResults, pagination: pageInfo }));
      } else {
        dispatch(appendSearchResults({ stakeholders: finalResults, pagination: pageInfo }));
      }
    } catch (e) {
      console.error('Search error:', e);
    } finally {
      dispatch(setSearching(false));
    }
  }, [dispatch]);

  // Only the non-empty fields become filters, so typing in one box does not require
  // the other. Trimmed so a stray space is not treated as a filter that returns
  // nothing.
  const buildFilters = useCallback(() => {
    const f: Record<string, string> = {};
    const nm = name.trim();
    const v = village.trim();
    const p = pin.trim();
    if (nm) f.name = nm;    // DAO `name` filter matches standardized OR original name
    if (v) f.city = v;      // DAO `city` filter matches city OR village
    if (p) f.pinCode = p;
    return f;
  }, [name, village, pin]);

  // Execute search when any filter changes (debounced for typing).
  useEffect(() => {
    const handler = setTimeout(() => {
      const filters = buildFilters();
      if (Object.keys(filters).length > 0) {
        search(filters);
      } else {
        dispatch(setSearchResults({ stakeholders: [], pagination: { page: 1, total: 0, hasMore: false } }));
      }
    }, 500);

    return () => clearTimeout(handler);
  }, [name, village, pin, buildFilters, search, dispatch]);

  const loadMore = () => {
    if (searchPagination.hasMore && !isSearching) {
      search(buildFilters(), searchPagination.page + 1);
    }
  };

  // Options shown in the open sheet, narrowed by the sheet's own filter box.
  // PIN narrowing is prefix-based to mirror how the DAO matches it
  // (`pin_code LIKE '412%'`); place names match anywhere in the string, since an
  // operator may only remember the tail of a compound name.
  const pickerItems = useMemo(() => {
    const source = openPicker === 'pin' ? pinOptions : placeOptions;
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return source;
    return openPicker === 'pin'
      ? source.filter(o => o.value.toLowerCase().startsWith(q))
      : source.filter(o => o.value.toLowerCase().includes(q));
  }, [openPicker, pinOptions, placeOptions, pickerQuery]);

  const openSheet = (which: 'place' | 'pin') => {
    Keyboard.dismiss();
    setPickerQuery('');
    setOpenPicker(which);
  };

  const chooseOption = (value: string) => {
    if (openPicker === 'pin') {
      setPin(value);
    } else {
      setVillage(value);
    }
    setOpenPicker(null);
    setPickerQuery('');
    setCollapsed(true);
  };

  const resetSearch = () => {
    setName('');
    setVillage('');
    setPin('');
    setCollapsed(false);
    dispatch(setSearchResults({ stakeholders: [], pagination: { page: 1, total: 0, hasMore: false } }));
  };

  // Text shown on the folded bar so the active filters stay visible while the
  // inputs themselves are hidden.
  const filterSummary = [
    name.trim() ? `"${name.trim()}"` : null,
    village.trim() || null,
    pin.trim() ? `PIN ${pin.trim()}` : null,
  ].filter(Boolean).join('  •  ');

  const renderStakeholder = useCallback(({ item }: { item: any }) => (
    <StakeholderCard 
      item={item} 
      onPress={() => navigation.navigate('StakeholderDetail', { stakeholderId: item.id })} 
    />
  ), [navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.container}>
        {/*
          Folded state: a one-line bar holding the active filters. Tapping it
          anywhere brings the panel back, so nothing is unreachable — this only
          trades panel height for result rows.
        */}
        {collapsed ? (
          <TouchableOpacity style={styles.collapsedBar} onPress={() => setCollapsed(false)} activeOpacity={0.8}>
            <Icon name="filter-variant" size={moderateScale(18)} color={colors.primary} />
            <Text style={styles.collapsedText} numberOfLines={1}>
              {filterSummary || 'Tap to set a filter'}
            </Text>
            <Icon name="chevron-down" size={moderateScale(22)} color={colors.textMuted} />
          </TouchableOpacity>
        ) : (
          /* Two independent filters — fill either, both, or neither. */
          <View style={styles.cascadeSection}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>Search Stakeholders</Text>
              <TouchableOpacity
                onPress={() => { Keyboard.dismiss(); setCollapsed(true); }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="chevron-up" size={moderateScale(24)} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Business name — free text only. A dropdown here would be a list as
                long as the whole dataset, so there is nothing useful to pick from;
                the DAO matches it as a substring against both name columns. */}
            <View style={styles.cascadeButton}>
              <Text style={styles.cascadeLabel}>Business Name</Text>
              <View style={styles.fieldRow}>
                <TextInput
                  style={[styles.cascadeInput, styles.fieldInput]}
                  value={name}
                  onChangeText={setName}
                  placeholder="Type a business name"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="search"
                  onSubmitEditing={() => { Keyboard.dismiss(); setCollapsed(true); }}
                />
                {name.length > 0 && (
                  <TouchableOpacity
                    style={styles.dropdownButton}
                    onPress={() => setName('')}
                    accessibilityRole="button"
                    accessibilityLabel="Clear the business name"
                  >
                    <Icon name="close-circle" size={moderateScale(20)} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* PIN sits first among the location filters: it is the field team's
                primary way in. */}
            <View style={styles.cascadeButton}>
              <Text style={styles.cascadeLabel}>PIN Code</Text>
              <View style={styles.fieldRow}>
                <TextInput
                  style={[styles.cascadeInput, styles.fieldInput]}
                  value={pin}
                  onChangeText={setPin}
                  placeholder="Type or pick a PIN code"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={6}
                  returnKeyType="search"
                  onSubmitEditing={() => { Keyboard.dismiss(); setCollapsed(true); }}
                />
                <TouchableOpacity
                  style={styles.dropdownButton}
                  onPress={() => openSheet('pin')}
                  accessibilityRole="button"
                  accessibilityLabel="Choose a PIN code from the list"
                >
                  <Icon name="menu-down" size={moderateScale(24)} color={colors.primary} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.cascadeButton}>
              <Text style={styles.cascadeLabel}>Village / City</Text>
              <View style={styles.fieldRow}>
                <TextInput
                  style={[styles.cascadeInput, styles.fieldInput]}
                  value={village}
                  onChangeText={setVillage}
                  placeholder="Type or pick a village / city"
                  placeholderTextColor={colors.textMuted}
                  returnKeyType="search"
                  onSubmitEditing={() => { Keyboard.dismiss(); setCollapsed(true); }}
                />
                <TouchableOpacity
                  style={styles.dropdownButton}
                  onPress={() => openSheet('place')}
                  accessibilityRole="button"
                  accessibilityLabel="Choose a village or city from the list"
                >
                  <Icon name="menu-down" size={moderateScale(24)} color={colors.primary} />
                </TouchableOpacity>
              </View>
            </View>

            <Text style={styles.helperText}>
              Search by name, PIN, or village/city. Use any field on its own, or combine them.
            </Text>

            {(name || village || pin) ? (
              <TouchableOpacity style={styles.resetButton} onPress={resetSearch}>
                <Text style={styles.resetButtonText}>Reset Search</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

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
          initialNumToRender={10}
          getItemLayout={(data, index) => (
            {length: moderateScale(120), offset: moderateScale(120) * index, index}
          )}
          ListEmptyComponent={
            !isSearching ? (
              <View style={styles.emptyState}>
                <Animated.View style={[{ marginBottom: spacing.md, transform: [{ scale: pulseAnim }] }]}>
                  <Icon name="account-search" size={60} color={colors.textMuted} />
                </Animated.View>
                <Text style={styles.emptyTitle}>Find Stakeholders</Text>
                <Text style={styles.emptyText}>Search by business name, PIN code, or village/city. Any field on its own works, or combine them.</Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            isSearching ? <ActivityIndicator color={colors.primary} style={{ padding: spacing.xl }} /> : null
          }
        />

        {/*
          Dropdown sheet, shared by both fields. It lists only values that exist
          in the local cache, each with its stakeholder count, so the operator
          can see where the work actually is before committing to a filter.
        */}
        <Modal
          visible={openPicker !== null}
          animationType="slide"
          transparent
          onRequestClose={() => setOpenPicker(null)}
        >
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerSheet}>
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>
                  {openPicker === 'pin' ? 'Select PIN Code' : 'Select Village / City'}
                </Text>
                <TouchableOpacity
                  onPress={() => setOpenPicker(null)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Icon name="close" size={moderateScale(24)} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <View style={styles.pickerSearchBox}>
                <Icon name="magnify" size={moderateScale(18)} color={colors.textMuted} />
                <TextInput
                  style={styles.pickerSearchInput}
                  value={pickerQuery}
                  onChangeText={setPickerQuery}
                  placeholder={openPicker === 'pin' ? 'Narrow the list…' : 'Narrow the list…'}
                  placeholderTextColor={colors.textMuted}
                  keyboardType={openPicker === 'pin' ? 'number-pad' : 'default'}
                  autoCorrect={false}
                />
              </View>

              <FlatList
                data={pickerItems}
                keyExtractor={(item) => item.value}
                keyboardShouldPersistTaps="handled"
                initialNumToRender={20}
                renderItem={({ item }) => {
                  const isActive = openPicker === 'pin' ? item.value === pin.trim() : item.value === village.trim();
                  return (
                    <TouchableOpacity style={styles.pickerItem} onPress={() => chooseOption(item.value)}>
                      <Text style={[styles.pickerItemText, isActive && styles.pickerItemTextActive]} numberOfLines={1}>
                        {item.value}
                      </Text>
                      <Text style={styles.pickerItemCount}>{item.count}</Text>
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <Text style={styles.pickerEmpty}>
                    {optionsLoading
                      ? 'Loading…'
                      : pickerQuery.trim()
                        ? 'No match. Clear the box above to see the full list.'
                        : 'Nothing available offline yet. Sync your stakeholder list first.'}
                  </Text>
                }
              />
            </View>
          </View>
        </Modal>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  cascadeSection: { padding: spacing.lg },
  cascadeButton: {
    backgroundColor: colors.bgInput, borderRadius: borderRadius.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.sm, ...shadows.card
  },
  cascadeLabel: { ...typography.caption, color: colors.textMuted },
  cascadeInput: { ...typography.body, color: colors.textPrimary, fontWeight: '600', marginTop: 2, padding: 0 },
  resetButton: { marginTop: spacing.xs, alignItems: 'center', padding: spacing.sm },
  resetButtonText: { color: colors.error, fontWeight: '600', fontSize: moderateScale(14) },

  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  panelTitle: { ...typography.body, fontWeight: '700', color: colors.textPrimary },
  fieldRow: { flexDirection: 'row', alignItems: 'center' },
  fieldInput: { flex: 1 },
  dropdownButton: { paddingLeft: spacing.sm, paddingVertical: moderateScale(2) },
  helperText: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs, marginLeft: spacing.xs },

  collapsedBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    backgroundColor: colors.bgInput, borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.card,
  },
  collapsedText: { ...typography.bodySmall, color: colors.textPrimary, fontWeight: '600', flex: 1 },

  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  pickerSheet: {
    backgroundColor: colors.bgPrimary, maxHeight: '75%',
    borderTopLeftRadius: borderRadius.lg, borderTopRightRadius: borderRadius.lg,
    paddingTop: spacing.lg, paddingBottom: spacing.xl,
  },
  pickerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, marginBottom: spacing.md,
  },
  pickerTitle: { ...typography.h2, color: colors.textPrimary },
  pickerSearchBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginBottom: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: moderateScale(6),
    backgroundColor: colors.bgInput, borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  pickerSearchInput: { ...typography.body, color: colors.textPrimary, flex: 1, padding: 0 },
  pickerItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  pickerItemText: { ...typography.body, color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  pickerItemTextActive: { color: colors.primary, fontWeight: '700' },
  pickerItemCount: { ...typography.caption, color: colors.textMuted },
  pickerEmpty: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center', padding: spacing.xl },

  
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
});