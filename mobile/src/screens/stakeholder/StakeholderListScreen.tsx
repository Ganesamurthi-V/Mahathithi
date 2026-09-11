import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Animated, Easing, DeviceEventEmitter, Modal, TextInput, ScrollView, Alert, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { stakeholderService } from '../../services/api';
import { stakeholderDao } from '../../database';
import NetInfo from '@react-native-community/netinfo';
import { useLiveData } from '../../hooks/useLiveData';
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
          <Text style={styles.meta}><Icon name="map-marker" size={14} color={colors.textMuted} /> {item.district || 'â€”'}</Text>
          <Text style={styles.meta}><Icon name="city" size={14} color={colors.textMuted} /> {item.city || 'â€”'}</Text>
          <Text style={styles.meta}><Icon name="mailbox" size={14} color={colors.textMuted} /> {item.pinCode || 'â€”'}</Text>
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
  const [totalCount, setTotalCount] = useState(0);
  const [showAdd, setShowAdd] = useState(false);

  const loadStakeholders = async (p = 1, isPullToRefresh = false) => {
    if (isPullToRefresh) setLoading(true);
    try {
      // Offline-First Architecture: Always read from SQLite
      const localData = await stakeholderDao.search({}, p);
      if (p === 1) {
        setStakeholders(localData);
        // PERF: don't block the list render on the COUNT(*) over 295K rows.
        // Fetch the badge count separately without awaiting so the cards
        // paint immediately; the badge fills in a beat later.
        stakeholderDao.searchCount({}).then(setTotalCount).catch(() => {});
      } else {
        setStakeholders(prev => [...prev, ...localData]);
      }
      setHasMore(localData.length === 20);
    } catch (e) {
      console.error('Failed to load stakeholders from SQLite:', e);
    } finally {
      setPage(p);
      setLoading(false);
      setInitialLoading(false);
    }
  };

  // Live: navigation focus, any server change to stakeholders/surveys, and app
  // foreground. Replaces the focus-only reload, which left a visible list showing
  // records that had already been edited or taken by someone else.
  //
  // Reloading page 1 (rather than clearing first) means the rows are swapped in
  // place with no flicker and no loss of the header/count.
  useLiveData(
    ['stakeholders', 'surveys'],
    useCallback(() => { loadStakeholders(1, false); }, [])
  );

  // Kept alongside the generic feed because these two have a better response than
  // a refetch: a lock removes exactly one known row, which is instant and avoids
  // re-querying 295K rows to discover the same thing.
  useEffect(() => {
    const onLocked = ({ stakeholderId }: { stakeholderId: string }) => {
      setStakeholders(prev => prev.filter(s => s.id !== stakeholderId));
      // Keep the badge honest after removing a row.
      stakeholderDao.searchCount({}).then(setTotalCount).catch(() => {});
    };

    const onUnlocked = () => {
      // Records were restored (e.g. an enumerator was deactivated), so the local
      // set genuinely changed â€” a full reload is the right response here.
      loadStakeholders(1, false);
    };

    const lockedSub = DeviceEventEmitter.addListener('stakeholder:locked', onLocked);
    const unlockedSub = DeviceEventEmitter.addListener('stakeholder:unlocked', onUnlocked);
    return () => {
      lockedSub.remove();
      unlockedSub.remove();
    };
  }, []);

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
          <View style={styles.headerRight}>
            {!initialLoading && (
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{totalCount} items</Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => setShowAdd(true)}
              accessibilityLabel="Add stakeholder"
              accessibilityRole="button"
            >
              <Icon name="plus" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        <AddStakeholderModal
          visible={showAdd}
          onClose={() => setShowAdd(false)}
          onCreated={(created) => {
            setShowAdd(false);
            // Refresh page 1 so the row is present when the operator comes back
            // from the survey, rather than only after the next full sync.
            loadStakeholders(1, true);
            // The point of adding a stakeholder in the field is to survey it, so go
            // straight there instead of making the operator find the row they just
            // created and open it. Back from the survey lands on this list.
            navigation.navigate('SurveyForm', {
              stakeholderId: created.id,
              stakeholder: created,
              survey: null,
            });
          }}
        />

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
            refreshControl={<RefreshControl refreshing={loading && page === 1} onRefresh={() => loadStakeholders(1, true)} tintColor={colors.primary} />}
            onEndReached={() => hasMore && !loading && loadStakeholders(page + 1, true)}
            onEndReachedThreshold={0.3}
            removeClippedSubviews={true}
            maxToRenderPerBatch={10}
            windowSize={5}
            // PERF: render only what fills the first viewport (~6-7 cards at 120px)
            // before first paint; the rest stream in via maxToRenderPerBatch.
            initialNumToRender={6}
            getItemLayout={(data, index) => (
              { length: 120, offset: 120 * index, index }
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.xl },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  addBtn: {
    backgroundColor: colors.primary,
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: spacing.sm,
  },
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


/**
 * The fields a field enumerator fills in when adding a stakeholder.
 *
 * Deliberately only what StakeholderDetailScreen displays, so what is captured and
 * what is shown afterwards match. The admin panel keeps the full 29-field form for
 * back-office data entry; a phone does not need it.
 *
 * Two of the displayed values are NOT inputs:
 *   District    assigned server-side from the enumerator's own assigned district,
 *               which is the access-control boundary — the server rejects any other
 *               value, so an editable field would imply a choice that does not exist.
 *   Data Source forced to 'MANUAL', the marker separating hand-entered rows from
 *               MCA/Udyam imports.
 * Both are surfaced as read-only text below the inputs so the operator can see what
 * the record will end up with.
 *
 * Address maps to fullAddressRaw, not addressLine1 — that is the column the detail
 * screen's ADDRESS row reads, so writing addressLine1 here would save a value that
 * never appears.
 */
type AddField = {
  key: string;
  label: string;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad';
  maxLength?: number;
  multiline?: boolean;
};

const ADD_FIELDS: AddField[] = [
  { key: 'companyNameStandardized', label: 'Organization Name *', placeholder: 'e.g. Datt Niwara Hotel', maxLength: 500 },
  { key: 'companyNameOriginal', label: 'Company Name', maxLength: 500 },
  { key: 'category', label: 'Category', placeholder: 'e.g. Worker Hostels', maxLength: 200 },
  { key: 'fullAddressRaw', label: 'Address', maxLength: 1000, multiline: true },
  { key: 'city', label: 'City', maxLength: 200 },
  { key: 'state', label: 'State', maxLength: 200 },
  { key: 'pinCode', label: 'PIN Code', keyboardType: 'number-pad', maxLength: 10 },
  { key: 'nicCode', label: 'NIC Code', maxLength: 20 },
  { key: 'nicDescription', label: 'NIC Description', maxLength: 500, multiline: true },
];

/**
 * Add a stakeholder from the field, then go straight to its survey form.
 *
 * ONLINE ONLY, and it says so rather than failing obscurely. The local sync_queue
 * can hold any entity type, but the server's /sync/upload only processes surveys
 * and media — a queued stakeholder create would never be sent, so offering this
 * offline would silently discard the operator's work. Survey capture itself still
 * works offline, including the survey this hands off to.
 */
function AddStakeholderModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (created: any) => void;
}) {
  const [saving, setSaving] = useState(false);

  const blankForm = useCallback(() => {
    const initial: Record<string, string> = {};
    for (const f of ADD_FIELDS) initial[f.key] = '';
    // Every record in this dataset is Maharashtra; prefilling saves a keystroke per
    // entry and the field stays editable.
    initial.state = 'Maharashtra';
    return initial;
  }, []);

  const [form, setForm] = useState<Record<string, string>>(blankForm);

  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!form.companyNameStandardized.trim()) {
      Alert.alert('Name required', 'Enter the organization name.');
      return;
    }

    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      Alert.alert(
        'No connection',
        'Adding a stakeholder needs an internet connection. Surveys still work offline — only new stakeholder records require being online.'
      );
      return;
    }

    setSaving(true);
    try {
      // Only non-empty keys: the server schema is .strict(), and sending blanks
      // would store '' where the detail screen expects a missing value (its rows
      // are filtered on truthiness, so '' and absent render the same, but the
      // export and search treat them differently).
      const payload: Record<string, string> = {};
      for (const f of ADD_FIELDS) {
        const v = form[f.key]?.trim();
        if (v) payload[f.key] = v;
      }

      const res = await stakeholderService.create(payload);
      const created = res.data?.data;
      if (!created?.id) throw new Error('Server did not return the created stakeholder');

      // Persist locally before navigating. The survey form and its save path read
      // the stakeholder from SQLite, so without this the survey could be written
      // against a stakeholder the local database has never heard of.
      await stakeholderDao.upsertMany([created]);

      setForm(blankForm());
      // No success alert: the handoff to the survey form is the confirmation, and a
      // dialog in between would just be one more tap before the real work.
      onCreated(created);
    } catch (e: any) {
      const detail = e.response?.data?.error?.details?.[0];
      Alert.alert(
        'Could not add stakeholder',
        (detail ? `${detail.path?.join('.') || 'field'}: ${detail.message}` : null) ||
          e.response?.data?.error?.message ||
          e.message ||
          'Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={addStyles.overlay}>
        <View style={addStyles.sheet}>
          <View style={addStyles.sheetHeader}>
            <Text style={addStyles.sheetTitle}>Add Stakeholder</Text>
            <TouchableOpacity onPress={onClose} disabled={saving} accessibilityLabel="Close">
              <Icon name="close" size={24} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={addStyles.note}>
            Saved, then the survey form opens straight away. Requires an internet
            connection.
          </Text>

          <ScrollView style={addStyles.body} keyboardShouldPersistTaps="handled">
            {ADD_FIELDS.map(f => (
              <View key={f.key} style={addStyles.field}>
                <Text style={addStyles.label}>{f.label}</Text>
                <TextInput
                  style={[addStyles.input, f.multiline && addStyles.inputMultiline]}
                  value={form[f.key] ?? ''}
                  onChangeText={t => set(f.key, t)}
                  placeholder={f.placeholder}
                  placeholderTextColor={colors.textMuted}
                  editable={!saving}
                  keyboardType={f.keyboardType ?? 'default'}
                  maxLength={f.maxLength}
                  multiline={f.multiline}
                  autoFocus={f.key === 'companyNameStandardized'}
                />
              </View>
            ))}

            {/* Set by the server, shown so the operator is not surprised by what
                appears on the detail screen afterwards. */}
            <View style={addStyles.serverSet}>
              <Text style={addStyles.serverSetTitle}>Set automatically</Text>
              <Text style={addStyles.serverSetRow}>District — your assigned district</Text>
              <Text style={addStyles.serverSetRow}>Data Source — MANUAL</Text>
              <Text style={addStyles.serverSetRow}>Status — OPEN</Text>
            </View>
          </ScrollView>

          <View style={addStyles.actions}>
            <TouchableOpacity
              style={[addStyles.btn, addStyles.btnSecondary]}
              onPress={onClose}
              disabled={saving}
            >
              <Text style={addStyles.btnSecondaryText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[addStyles.btn, addStyles.btnPrimary, saving && addStyles.btnDisabled]}
              onPress={submit}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={addStyles.btnPrimaryText}>Save &amp; Start Survey</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const addStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bgPrimary,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    maxHeight: '92%',
    paddingBottom: spacing.xl,
  },
  sheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  sheetTitle: { ...typography.h3, color: colors.textPrimary },
  note: {
    ...typography.bodySmall, color: colors.textMuted,
    paddingHorizontal: spacing.xl, paddingTop: spacing.md,
  },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  field: { marginBottom: spacing.md },
  label: { ...typography.caption, color: colors.textMuted, marginBottom: 4 },
  input: {
    backgroundColor: colors.bgCard,
    borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.textPrimary,
  },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  serverSet: {
    marginTop: spacing.sm, marginBottom: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  serverSetTitle: { ...typography.caption, color: colors.textMuted, marginBottom: 6 },
  serverSetRow: { ...typography.bodySmall, color: colors.textPrimary, marginBottom: 2 },
  actions: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  btn: { flex: 1, paddingVertical: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { color: '#fff', fontWeight: '600' },
  btnSecondary: { backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border },
  btnSecondaryText: { color: colors.textPrimary, fontWeight: '600' },
  btnDisabled: { opacity: 0.6 },
});
