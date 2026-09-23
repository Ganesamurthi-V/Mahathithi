import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { surveyDao } from '../../database';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { moderateScale } from '../../theme/responsive';

// One draft row. Tapping it reopens the survey form with the SAME params the
// stakeholder detail screen passes, so the draft restores identically and the
// enumerator can carry on editing exactly where they left off.
const DraftCard = React.memo(({ item, onPress }: { item: any; onPress: () => void }) => {
  const s = item.stakeholder || {};
  const sv = item.survey || {};
  // Prefer the name captured in the survey draft itself; fall back to the
  // stakeholder record so a row is never blank.
  const title = sv.business_name || s.companyNameStandardized || s.companyNameOriginal || 'Untitled draft';
  const updated = sv.updated_at ? new Date(sv.updated_at.replace(' ', 'T')) : null;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.9}>
      <View style={styles.cardHeader}>
        <Text style={styles.orgName} numberOfLines={1}>{title}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>DRAFT</Text>
        </View>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.meta}><Icon name="map-marker" size={14} color={colors.textMuted} /> {s.district || '—'}</Text>
        <Text style={styles.meta}><Icon name="city" size={14} color={colors.textMuted} /> {s.city || '—'}</Text>
        <Text style={styles.meta}><Icon name="mailbox" size={14} color={colors.textMuted} /> {s.pinCode || '—'}</Text>
      </View>
      {updated && (
        <Text style={styles.updated}>
          <Icon name="clock-outline" size={12} color={colors.textMuted} /> Last edited {updated.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </Text>
      )}
    </TouchableOpacity>
  );
});

export default function DraftsScreen({ navigation }: any) {
  const [drafts, setDrafts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const rows = await surveyDao.getDrafts();
      setDrafts(rows);
    } catch (e) {
      // Leave the last known list on screen if the read fails.
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload every time the screen gains focus so a draft the enumerator just
  // completed (and submitted) drops off the list on return, and a newly saved
  // draft appears.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const openDraft = useCallback((item: any) => {
    navigation.navigate('SurveyForm', {
      stakeholderId: item.stakeholderId,
      stakeholder: item.stakeholder,
      survey: item.survey,
    });
  }, [navigation]);

  const renderItem = useCallback(({ item }: { item: any }) => (
    <DraftCard item={item} onPress={() => openDraft(item)} />
  ), [openDraft]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={drafts}
        renderItem={renderItem}
        keyExtractor={(item) => item.survey?.id || item.stakeholderId}
        contentContainerStyle={drafts.length === 0 ? styles.emptyContent : styles.list}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="file-document-edit-outline" size={moderateScale(56)} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No drafts</Text>
            <Text style={styles.emptyText}>
              Partially filled surveys you save will appear here so you can finish them later.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: spacing.xl },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
    ...shadows.card,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  orgName: { ...typography.body, color: colors.textPrimary, fontWeight: '700', flex: 1, marginRight: spacing.sm },
  badge: { backgroundColor: colors.warning, borderRadius: borderRadius.full, paddingHorizontal: spacing.md, paddingVertical: 2 },
  badgeText: { color: '#1B1715', fontSize: moderateScale(10), fontWeight: '800', letterSpacing: 0.5 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  meta: { ...typography.bodySmall, color: colors.textSecondary },
  updated: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  empty: { alignItems: 'center', paddingHorizontal: spacing.xxl },
  emptyTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.lg },
  emptyText: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
});
