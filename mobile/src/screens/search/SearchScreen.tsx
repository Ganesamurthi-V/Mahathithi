import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, TextInput,
  StyleSheet, ActivityIndicator, Modal, Animated, Easing
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import { setSearchResults, appendSearchResults, setSearching } from '../../store/slices/stakeholderSlice';
import { stakeholderService } from '../../services/api';
import { stakeholderDao } from '../../database';
import NetInfo from '@react-native-community/netinfo';
import { colors, spacing, borderRadius, typography, shadows, animations } from '../../theme';
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
  const { user } = useSelector((state: RootState) => state.auth);
  
  // Cascaded Search State
  const [availableDistricts, setAvailableDistricts] = useState<string[]>([]);
  const [availableCities, setAvailableCities] = useState<string[]>([]);
  const [availablePins, setAvailablePins] = useState<string[]>([]);
  
  const [selectedDistrict, setSelectedDistrict] = useState<string>('');
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [selectedPin, setSelectedPin] = useState<string>('');
  
  const [pickerType, setPickerType] = useState<'district' | 'city' | 'pin' | null>(null);

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
    if (pickerType) {
      Animated.spring(filterSlideAnim, { toValue: 0, useNativeDriver: true, ...animations.spring.bouncy }).start();
    } else {
      Animated.timing(filterSlideAnim, { toValue: 500, duration: 250, useNativeDriver: true }).start();
    }
  }, [pickerType]);

  // Load assigned districts from user profile
  useEffect(() => {
    if (user && user.districts) {
      setAvailableDistricts(user.districts.map((d: any) => d.name));
    }
  }, [user]);

  // Cascade logic
  useEffect(() => {
    if (selectedDistrict) {
      stakeholderDao.getUniqueCities(selectedDistrict).then(setAvailableCities);
      setSelectedCity('');
      setSelectedPin('');
      setAvailablePins([]);
    } else {
      setAvailableCities([]);
      setSelectedCity('');
      setAvailablePins([]);
      setSelectedPin('');
    }
  }, [selectedDistrict]);

  useEffect(() => {
    if (selectedCity) {
      stakeholderDao.getUniquePins(selectedCity).then(setAvailablePins);
      setSelectedPin('');
    } else {
      setAvailablePins([]);
      setSelectedPin('');
    }
  }, [selectedCity]);


  const search = useCallback(async (activeFilters: Record<string, string>, page = 1) => {
    dispatch(setSearching(true));

    try {
      const netState = await NetInfo.fetch();
      const isOnline = netState.isConnected;

      if (isOnline) {
        const params: Record<string, any> = { page, limit: 20 };
        Object.entries(activeFilters).forEach(([k, v]) => { if (v) params[k] = v; });

        const res = await stakeholderService.search(params);
        const { stakeholders, pagination } = res.data.data;

        if (page === 1) {
          dispatch(setSearchResults({ stakeholders, pagination }));
        } else {
          dispatch(appendSearchResults({ stakeholders, pagination }));
        }
      } else {
        const results = await stakeholderDao.search(activeFilters, page);
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

  // Execute search when filters change (debounced for TextInputs)
  useEffect(() => {
    const handler = setTimeout(() => {
      if (selectedDistrict || selectedCity || selectedPin) {
        search({ district: selectedDistrict, city: selectedCity, pinCode: selectedPin });
      } else {
        dispatch(setSearchResults({ stakeholders: [], pagination: { page: 1, total: 0, hasMore: false } }));
      }
    }, 500);

    return () => clearTimeout(handler);
  }, [selectedDistrict, selectedCity, selectedPin, search, dispatch]);

  const loadMore = () => {
    if (searchPagination.hasMore && !isSearching) {
      search({ district: selectedDistrict, city: selectedCity, pinCode: selectedPin }, searchPagination.page + 1);
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
      {/* Cascaded Selection Area */}
      <View style={styles.cascadeSection}>
        <TouchableOpacity style={styles.cascadeButton} onPress={() => setPickerType('district')}>
          <Text style={styles.cascadeLabel}>District</Text>
          <Text style={styles.cascadeValue}>{selectedDistrict || 'Select District ▼'}</Text>
        </TouchableOpacity>
        
        <View style={[styles.cascadeButton, !selectedDistrict && styles.cascadeDisabled]}>
          <Text style={styles.cascadeLabel}>City / Village</Text>
          <TextInput 
            style={styles.cascadeInput}
            value={selectedCity}
            onChangeText={setSelectedCity}
            placeholder="Enter City or Village"
            placeholderTextColor={colors.textMuted}
            editable={!!selectedDistrict}
          />
        </View>
        
        <View style={[styles.cascadeButton, !selectedCity && styles.cascadeDisabled]}>
          <Text style={styles.cascadeLabel}>PIN Code</Text>
          <TextInput 
            style={styles.cascadeInput}
            value={selectedPin}
            onChangeText={setSelectedPin}
            placeholder="Enter PIN Code"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            editable={!!selectedCity}
            maxLength={6}
          />
        </View>
        
        {(selectedDistrict || selectedCity || selectedPin) ? (
          <TouchableOpacity style={styles.resetButton} onPress={() => {
            setSelectedDistrict('');
            dispatch(setSearchResults({ stakeholders: [], pagination: { page: 1, total: 0, hasMore: false } }));
          }}>
            <Text style={styles.resetButtonText}>Reset Search</Text>
          </TouchableOpacity>
        ) : null}
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
          {length: moderateScale(120), offset: moderateScale(120) * index, index}
        )}
        ListEmptyComponent={
          !isSearching ? (
            <View style={styles.emptyState}>
              <Animated.Text style={[styles.emptyIcon, { transform: [{ scale: pulseAnim }] }]}>🔍</Animated.Text>
              <Text style={styles.emptyTitle}>Find Stakeholders</Text>
              <Text style={styles.emptyText}>Select a District, City, and PIN to locate stakeholders in your assigned area.</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          isSearching ? <ActivityIndicator color={colors.primary} style={{ padding: spacing.xl }} /> : null
        }
      />

      {/* Picker Modal */}
      <Modal visible={!!pickerType} animationType="fade" transparent>
        <TouchableOpacity style={styles.filterOverlay} activeOpacity={1} onPress={() => setPickerType(null)}>
          <Animated.View style={[styles.filterModal, { transform: [{ translateY: filterSlideAnim }] }]}>
            <View style={styles.pickerHeader}>
              <Text style={styles.filterTitle}>
                Select {pickerType === 'district' ? 'District' : pickerType === 'city' ? 'City' : 'PIN'}
              </Text>
              <TouchableOpacity onPress={() => setPickerType(null)}>
                <Text style={styles.closePickerIcon}>✕</Text>
              </TouchableOpacity>
            </View>
            
            <FlatList
              data={
                pickerType === 'district' ? availableDistricts :
                pickerType === 'city' ? availableCities :
                pickerType === 'pin' ? availablePins : []
              }
              keyExtractor={(i) => i}
              style={{ maxHeight: moderateScale(300) }}
              renderItem={({item}) => (
                <TouchableOpacity style={styles.pickerItem} onPress={() => {
                  if (pickerType === 'district') setSelectedDistrict(item);
                  if (pickerType === 'city') setSelectedCity(item);
                  if (pickerType === 'pin') setSelectedPin(item);
                  setPickerType(null);
                }}>
                  <Text style={styles.pickerItemText}>{item}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyPickerText}>No options available</Text>
              }
            />
          </Animated.View>
        </TouchableOpacity>
      </Modal>
    </View>
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
  cascadeDisabled: { opacity: 0.5 },
  cascadeLabel: { ...typography.caption, color: colors.textMuted },
  cascadeValue: { ...typography.body, color: colors.textPrimary, fontWeight: '600', marginTop: 2 },
  cascadeInput: { ...typography.body, color: colors.textPrimary, fontWeight: '600', marginTop: 2, padding: 0 },
  resetButton: { marginTop: spacing.xs, alignItems: 'center', padding: spacing.sm },
  resetButtonText: { color: colors.error, fontWeight: '600', fontSize: moderateScale(14) },
  
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
    padding: spacing.xl, paddingBottom: spacing.xxxl,
    ...shadows.elevated,
  },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  filterTitle: { ...typography.h2, color: colors.textPrimary },
  closePickerIcon: { fontSize: moderateScale(24), color: colors.textMuted, padding: spacing.xs },
  pickerItem: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerItemText: { ...typography.body, color: colors.textPrimary, fontSize: moderateScale(16) },
  emptyPickerText: { ...typography.body, color: colors.textMuted, textAlign: 'center', padding: spacing.xl },
});
