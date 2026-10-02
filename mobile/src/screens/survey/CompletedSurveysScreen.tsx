import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { surveyDao } from '../../database';
import { announceLocalDataChange } from '../../services/realtime';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { moderateScale } from '../../theme/responsive';

// One completed survey row. Tapping the edit button reverts the survey to a
// draft, reopens the stakeholder, and opens the form for re-editing.
const CompletedCard = React.memo(({ item, onEdit }: { item: any; onEdit: () => void }) => {
  const s = item.stakeholder || {};
  const sv = item.survey || {};
  const title = sv.business_name || s.companyNameStandardized || s.companyNameOriginal || 'Unnamed survey';
  const completedAt = sv.updated_at ? new Date(sv.updated_at.replace(' ', 'T')) : null;
  const isSynced = sv.is_synced === 1;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.orgName} numberOfLines={1}>{title}</Text>
        <View style={[styles.badge, isSynced && styles.badgeSynced]}>
          <Text style={[styles.badgeText, isSynced && styles.badgeTextSynced]}>
            {isSynced ? 'SYNCED' : 'PENDING'}
          </Text>
        </View>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.meta}><Icon name="map-marker" size={14} color={colors.textMuted} /> {s.district || '—'}</Text>
        <Text style={styles.meta}><Icon name="city" size={14} color={colors.textMuted} /> {s.city || '—'}</Text>
        <Text style={styles.meta}><Icon name="mailbox" size={14} color={colors.textMuted} /> {s.pinCode || '—'}</Text>
      </View>
      {completedAt && (
        <Text style={styles.updated}>
          <Icon name="check-circle" size={12} color={colors.success} /> Completed {completedAt.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </Text>
      )}
      <TouchableOpacity style={styles.editButton} onPress={onEdit} activeOpacity={0.8}>
        <Icon name="pencil-outline" size={moderateScale(16)} color="#FFF" />
        <Text style={styles.editButtonText}>Edit Survey</Text>
      </TouchableOpacity>
    </View>
  );
});

export default function CompletedSurveysScreen({ navigation }: any) {
  const [surveys, setSurveys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const rows = await surveyDao.getCompletedSurveys();
      setSurveys(rows);
    } catch (e) {
      // Leave the last known list on screen if the read fails.
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload every time the screen gains focus so a survey the enumerator just
  // re-submitted drops off the list on return.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleEdit = useCallback((item: any) => {
    navigation.navigate('SurveyForm', {
      stakeholderId: item.stakeholderId,
      stakeholder: item.stakeholder,
      survey: item.survey,
    });
  }, [navigation]);

  const renderItem = useCallback(({ item }: { item: any }) => (
    <CompletedCard item={item} onEdit={() => handleEdit(item)} />
  ), [handleEdit]);

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
        data={surveys}
        renderItem={renderItem}
        keyExtractor={(item) => item.survey?.id || item.stakeholderId}
        contentContainerStyle={surveys.length === 0 ? styles.emptyContent : styles.list}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="check-circle-outline" size={moderateScale(56)} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No completed surveys</Text>
            <Text style={styles.emptyText}>
              Surveys you have submitted will appear here. You can edit and re-submit them if needed.
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
    borderLeftColor: colors.success,
    ...shadows.card,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  orgName: { ...typography.body, color: colors.textPrimary, fontWeight: '700', flex: 1, marginRight: spacing.sm },
  badge: { backgroundColor: colors.warning, borderRadius: borderRadius.full, paddingHorizontal: spacing.md, paddingVertical: 2 },
  badgeSynced: { backgroundColor: colors.success },
  badgeText: { color: '#1B1715', fontSize: moderateScale(10), fontWeight: '800', letterSpacing: 0.5 },
  badgeTextSynced: { color: '#FFF' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  meta: { ...typography.bodySmall, color: colors.textSecondary },
  updated: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    alignSelf: 'flex-end',
  },
  editButtonText: { color: '#FFF', fontSize: moderateScale(13), fontWeight: '700' },
  empty: { alignItems: 'center', paddingHorizontal: spacing.xxl },
  emptyTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.lg },
  emptyText: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
});
