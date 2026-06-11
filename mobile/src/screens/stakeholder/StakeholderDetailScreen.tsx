import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { stakeholderService, surveyService } from '../../services/api';
import { colors, spacing, borderRadius, typography } from '../../theme';

export default function StakeholderDetailScreen({ route, navigation }: any) {
  const { stakeholderId } = route.params;
  const [stakeholder, setStakeholder] = useState<any>(null);
  const [survey, setSurvey] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [stakeholderId]);

  const loadData = async () => {
    try {
      const [shRes, svRes] = await Promise.all([
        stakeholderService.getById(stakeholderId),
        surveyService.getByStakeholder(stakeholderId).catch(() => ({ data: { data: null } })),
      ]);
      setStakeholder(shRes.data.data);
      setSurvey(svRes.data.data);
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.error?.message || 'Failed to load stakeholder');
    }
    setLoading(false);
  };

  if (loading || !stakeholder) {
    return <View style={styles.container}><Text style={styles.loading}>Loading...</Text></View>;
  }

  const s = stakeholder;
  const infoRows = [
    { label: 'Organization Name', value: s.companyNameStandardized },
    { label: 'Company Name', value: s.companyNameOriginal },
    { label: 'Address', value: s.fullAddressRaw },
    { label: 'District', value: s.district },
    { label: 'Taluka', value: s.taluka },
    { label: 'City', value: s.city },
    { label: 'Village', value: s.village },
    { label: 'State', value: s.state },
    { label: 'PIN Code', value: s.pinCode },
    { label: 'GST Number', value: s.gstNumber },
    { label: 'CIN Number', value: s.cinNumber },
    { label: 'Category', value: s.category },
    { label: 'NIC Code', value: s.nicCode },
    { label: 'NIC Description', value: s.nicDescription },
    { label: 'Company Class', value: s.companyClass },
    { label: 'Company Status', value: s.companyStatus },
    { label: 'Company Category', value: s.companyCategory },
    { label: 'Authorized Capital', value: s.authorizedCapital?.toLocaleString() },
    { label: 'Paid-up Capital', value: s.paidupCapital?.toLocaleString() },
    { label: 'Listing Status', value: s.listingStatus },
    { label: 'Registration Date', value: s.registrationDate },
    { label: 'Data Source', value: s.dataSource },
    { label: 'Priority Weight', value: s.priorityWeight?.toString() },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Status Header */}
      <View style={[styles.statusBar, { borderLeftColor: getStatusColor(s.status) }]}>
        <View>
          <Text style={styles.statusLabel}>STATUS</Text>
          <Text style={[styles.statusValue, { color: getStatusColor(s.status) }]}>
            {s.status?.replace('_', ' ')}
          </Text>
        </View>
        <Text style={styles.uin}>{s.uin}</Text>
      </View>

      {/* Pre-populated Data */}
      <Text style={styles.sectionTitle}>📋 Stakeholder Information</Text>
      <View style={styles.infoCard}>
        {infoRows.map((row, i) => (
          row.value ? (
            <View key={i} style={[styles.infoRow, i < infoRows.length - 1 && styles.infoRowBorder]}>
              <Text style={styles.infoLabel}>{row.label}</Text>
              <Text style={styles.infoValue}>{row.value}</Text>
            </View>
          ) : null
        ))}
      </View>

      {/* Survey Data (if exists) */}
      {survey && (
        <>
          <Text style={styles.sectionTitle}>📝 Survey Data</Text>
          <View style={styles.infoCard}>
            {[
              { label: 'Contact Person', value: survey.contactPerson },
              { label: 'Designation', value: survey.designation },
              { label: 'Mobile', value: survey.mobileNumber },
              { label: 'Email', value: survey.email },
              { label: 'Website', value: survey.website },
              { label: 'GPS', value: survey.latitude ? `${survey.latitude}, ${survey.longitude}` : null },
            ].map((row, i) => (
              row.value ? (
                <View key={i} style={styles.infoRow}>
                  <Text style={styles.infoLabel}>{row.label}</Text>
                  <Text style={styles.infoValue}>{row.value}</Text>
                </View>
              ) : null
            ))}
          </View>
        </>
      )}

      {/* Action Buttons */}
      {s.status !== 'COMPLETED' && (() => {
        const activeSurveyId = survey?.id || `draft_${stakeholderId}`;
        return (
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actionPrimary}
            onPress={() => navigation.navigate('SurveyForm', { stakeholderId, stakeholder: s, survey })}
          >
            <Text style={styles.actionPrimaryText}>📝 Start / Edit Survey</Text>
          </TouchableOpacity>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.actionSecondary}
              onPress={() => navigation.navigate('PhotoCapture', { stakeholderId, surveyId: activeSurveyId })}
            >
              <Text style={styles.actionSecondaryText}>📷 Photos</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionSecondary}
              onPress={() => navigation.navigate('VideoCapture', { stakeholderId, surveyId: activeSurveyId })}
            >
              <Text style={styles.actionSecondaryText}>🎥 Video</Text>
            </TouchableOpacity>

          </View>
        </View>
        );
      })()}
    </ScrollView>
  );
}

function getStatusColor(status: string) {
  const map: Record<string, string> = {
    PENDING: colors.statusPending,
    IN_PROGRESS: colors.statusInProgress,
    IN_REVIEW: colors.statusInReview,
    COMPLETED: colors.statusCompleted,
  };
  return map[status] || colors.statusPending;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { padding: spacing.xl, paddingBottom: 100 },
  loading: { color: colors.textMuted, textAlign: 'center', marginTop: 100 },
  statusBar: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.xl, borderWidth: 1, borderColor: colors.border,
    borderLeftWidth: 4, flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: spacing.xxl,
  },
  statusLabel: { ...typography.caption, color: colors.textMuted },
  statusValue: { fontSize: 18, fontWeight: '700', marginTop: 2 },
  uin: { ...typography.bodySmall, color: colors.textMuted },
  sectionTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  infoCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xxl, overflow: 'hidden',
  },
  infoRow: { padding: spacing.lg },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  infoLabel: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.xs },
  infoValue: { ...typography.body, color: colors.textPrimary },
  actions: { marginTop: spacing.lg },
  actionPrimary: {
    backgroundColor: colors.primary, borderRadius: borderRadius.md,
    padding: spacing.lg, alignItems: 'center', marginBottom: spacing.md,
  },
  actionPrimaryText: { ...typography.button, color: '#FFF' },
  actionRow: { flexDirection: 'row', gap: spacing.md },
  actionSecondary: {
    flex: 1, backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  },
  actionSecondaryText: { ...typography.label, color: colors.textPrimary },
});
