import React, { useEffect, useState, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Animated, LayoutAnimation, UIManager, Platform } from 'react-native';
import { stakeholderService, surveyService } from '../../services/api';
import { colors, spacing, borderRadius, typography, shadows, animations } from '../../theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const CollapsibleSection = ({ title, children, defaultExpanded = false, index }: { title: string, children: React.ReactNode, defaultExpanded?: boolean, index: number }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const slideAnim = useRef(new Animated.Value(50)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, delay: index * 100, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 40, friction: 8, delay: index * 100, useNativeDriver: true }),
    ]).start();
  }, []);

  const toggleExpand = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(!expanded);
  };

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <TouchableOpacity style={styles.sectionHeader} onPress={toggleExpand} activeOpacity={0.8}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {expanded && (
        <View style={styles.infoCard}>
          {children}
        </View>
      )}
    </Animated.View>
  );
};

const ActionButton = ({ icon, text, onPress, primary = false }: { icon: string, text: string, onPress: () => void, primary?: boolean }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => Animated.spring(scaleAnim, { toValue: 0.95, useNativeDriver: true }).start();
  const handlePressOut = () => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start();

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }], flex: primary ? undefined : 1 }}>
      <TouchableOpacity
        style={primary ? styles.actionPrimary : styles.actionSecondary}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.9}
      >
        {icon && <Text style={primary ? styles.actionPrimaryIcon : styles.actionSecondaryIcon}>{icon}</Text>}
        <Text style={primary ? styles.actionPrimaryText : styles.actionSecondaryText}>{text}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const SkeletonDetail = () => {
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
    <Animated.View style={[styles.container, { padding: spacing.xl, opacity: pulseAnim }]}>
      <View style={[styles.statusBar, { borderColor: colors.border, borderLeftColor: colors.border }]} />
      <View style={{ height: 40, backgroundColor: colors.border, borderRadius: 8, marginBottom: 16, width: '40%' }} />
      <View style={{ height: 150, backgroundColor: colors.border, borderRadius: 12, marginBottom: 24 }} />
      <View style={{ height: 40, backgroundColor: colors.border, borderRadius: 8, marginBottom: 16, width: '40%' }} />
      <View style={{ height: 200, backgroundColor: colors.border, borderRadius: 12 }} />
    </Animated.View>
  );
};

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
    return <SkeletonDetail />;
  }

  const s = stakeholder;

  const basicInfo = [
    { label: 'Organization Name', value: s.companyNameStandardized },
    { label: 'Company Name', value: s.companyNameOriginal },
    { label: 'Category', value: s.category },
    { label: 'Data Source', value: s.dataSource },
  ];

  const locationInfo = [
    { label: 'Address', value: s.fullAddressRaw },
    { label: 'District', value: s.district },
    { label: 'Taluka', value: s.taluka },
    { label: 'City', value: s.city },
    { label: 'Village', value: s.village },
    { label: 'State', value: s.state },
    { label: 'PIN Code', value: s.pinCode },
  ];

  const registrationInfo = [
    { label: 'GST Number', value: s.gstNumber },
    { label: 'CIN Number', value: s.cinNumber },
    { label: 'NIC Code', value: s.nicCode },
    { label: 'NIC Description', value: s.nicDescription },
    { label: 'Company Class', value: s.companyClass },
    { label: 'Company Status', value: s.companyStatus },
    { label: 'Company Category', value: s.companyCategory },
    { label: 'Authorized Capital', value: s.authorizedCapital?.toLocaleString() },
    { label: 'Paid-up Capital', value: s.paidupCapital?.toLocaleString() },
    { label: 'Listing Status', value: s.listingStatus },
    { label: 'Registration Date', value: s.registrationDate },
  ];

  const renderInfoRows = (rows: any[]) => {
    return rows.map((row, i) => (
      row.value ? (
        <View key={i} style={[styles.infoRow, i < rows.length - 1 && styles.infoRowBorder]}>
          <Text style={styles.infoLabel}>{row.label}</Text>
          <Text style={styles.infoValue}>{row.value}</Text>
        </View>
      ) : null
    ));
  };

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
        <View style={styles.uinBadge}>
          <Text style={styles.uinLabel}>UIN</Text>
          <Text style={styles.uin}>{s.uin}</Text>
        </View>
      </View>

      <CollapsibleSection title="📋 Basic Information" index={0} defaultExpanded={true}>
        {renderInfoRows(basicInfo)}
      </CollapsibleSection>

      <CollapsibleSection title="📍 Location Details" index={1}>
        {renderInfoRows(locationInfo)}
      </CollapsibleSection>

      <CollapsibleSection title="🏛 Registration Info" index={2}>
        {renderInfoRows(registrationInfo)}
      </CollapsibleSection>

      {/* Survey Data (if exists) */}
      {survey && (
        <CollapsibleSection title="📝 Survey Data" index={3} defaultExpanded={true}>
          {renderInfoRows([
            { label: 'Contact Person', value: survey.contactPerson },
            { label: 'Designation', value: survey.designation },
            { label: 'Mobile', value: survey.mobileNumber },
            { label: 'Email', value: survey.email },
            { label: 'Website', value: survey.website },
            { label: 'GPS', value: survey.latitude ? `${survey.latitude.toFixed(6)}, ${survey.longitude.toFixed(6)}` : null },
          ])}
        </CollapsibleSection>
      )}

      {/* Action Buttons */}
      {s.status !== 'COMPLETED' && (() => {
        const activeSurveyId = survey?.id || `draft_${stakeholderId}`;
        return (
        <View style={styles.actions}>
          <ActionButton 
            primary
            icon="📝"
            text="Start / Edit Survey"
            onPress={() => navigation.navigate('SurveyForm', { stakeholderId, stakeholder: s, survey })}
          />

          <View style={styles.actionRow}>
            <ActionButton 
              icon="📷"
              text="Photos"
              onPress={() => navigation.navigate('PhotoCapture', { stakeholderId, surveyId: activeSurveyId })}
            />
            <ActionButton 
              icon="🎥"
              text="Video"
              onPress={() => navigation.navigate('VideoCapture', { stakeholderId, surveyId: activeSurveyId })}
            />
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
  statusBar: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.xl, borderWidth: 1, borderColor: colors.border,
    borderLeftWidth: 6, flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: spacing.xxl,
    ...shadows.card,
  },
  statusLabel: { ...typography.caption, color: colors.textMuted },
  statusValue: { fontSize: 20, fontWeight: '800', marginTop: 2, letterSpacing: 0.5 },
  uinBadge: { backgroundColor: colors.bgInput, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, alignItems: 'flex-end' },
  uinLabel: { ...typography.caption, color: colors.textMuted, fontSize: 9 },
  uin: { ...typography.bodySmall, color: colors.textPrimary, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md, paddingVertical: 4 },
  sectionTitle: { ...typography.h3, color: colors.textPrimary },
  chevron: { color: colors.textMuted, fontSize: 12 },
  
  infoCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xxl, overflow: 'hidden',
    ...shadows.card,
  },
  infoRow: { padding: spacing.lg },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  infoLabel: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.xs },
  infoValue: { ...typography.body, color: colors.textPrimary, fontWeight: '500' },
  
  actions: { marginTop: spacing.lg },
  actionPrimary: {
    flexDirection: 'row', justifyContent: 'center', backgroundColor: colors.primary, 
    borderRadius: borderRadius.md, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.md,
    ...shadows.elevated,
  },
  actionPrimaryIcon: { fontSize: 20, marginRight: 8 },
  actionPrimaryText: { ...typography.button, color: '#FFF', fontSize: 16 },
  
  actionRow: { flexDirection: 'row', gap: spacing.md },
  actionSecondary: {
    flexDirection: 'row', justifyContent: 'center', backgroundColor: colors.bgCard, 
    borderRadius: borderRadius.md, padding: spacing.lg, alignItems: 'center', 
    borderWidth: 1, borderColor: colors.border,
    ...shadows.card,
  },
  actionSecondaryIcon: { fontSize: 20, marginRight: 8 },
  actionSecondaryText: { ...typography.label, color: colors.textPrimary, fontSize: 15 },
});
