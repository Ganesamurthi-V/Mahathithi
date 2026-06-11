import React, { useEffect, useState, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Animated, LayoutAnimation, UIManager, Platform } from 'react-native';
import { stakeholderService, surveyService } from '../../services/api';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { moderateScale } from '../../theme/responsive';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const CollapsibleSection = ({ title, icon, children, defaultExpanded = false, index }: { title: string, icon: string, children: React.ReactNode, defaultExpanded?: boolean, index: number }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const slideAnim = useRef(new Animated.Value(50)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, delay: index * 100, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 40, friction: 8, delay: index * 100, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim, index]);

  const toggleExpand = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(!expanded);
  };

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }], marginBottom: spacing.lg }}>
      <TouchableOpacity style={styles.sectionHeader} onPress={toggleExpand} activeOpacity={0.8}>
        <View style={styles.sectionHeaderLeft}>
          <View style={styles.sectionIconWrapper}>
            <Icon name={icon} size={moderateScale(20)} color={colors.primary} />
          </View>
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={moderateScale(24)} color={colors.textMuted} />
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
        {icon && <Icon name={icon} size={moderateScale(20)} color={primary ? '#FFF' : colors.primary} style={styles.actionIcon} />}
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
  }, [pulseAnim]);

  return (
    <Animated.View style={[styles.container, { padding: spacing.xl, opacity: pulseAnim }]}>
      <View style={{ height: moderateScale(100), backgroundColor: colors.border, borderRadius: borderRadius.xl, marginBottom: spacing.xl }} />
      <View style={{ height: moderateScale(40), backgroundColor: colors.border, borderRadius: borderRadius.md, marginBottom: spacing.md, width: '40%' }} />
      <View style={{ height: moderateScale(150), backgroundColor: colors.border, borderRadius: borderRadius.xl, marginBottom: spacing.xxl }} />
      <View style={{ height: moderateScale(40), backgroundColor: colors.border, borderRadius: borderRadius.md, marginBottom: spacing.md, width: '40%' }} />
      <View style={{ height: moderateScale(200), backgroundColor: colors.border, borderRadius: borderRadius.xl }} />
    </Animated.View>
  );
};

export default function StakeholderDetailScreen({ route, navigation }: any) {
  const { stakeholderId } = route.params;
  const [stakeholder, setStakeholder] = useState<any>(null);
  const [survey, setSurvey] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();

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

  const statusColor = getStatusColor(s.status);
  const isCompleted = s.status === 'CLOSED';

  return (
    <View style={styles.mainContainer}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Hero Header */}
        <View style={[styles.heroHeader, { backgroundColor: statusColor + '15', borderColor: statusColor + '40' }]}>
          <View style={styles.heroStatusContainer}>
            <View style={[styles.statusIndicator, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusValue, { color: statusColor }]}>
              {s.status?.replace('_', ' ')}
            </Text>
          </View>
          <View style={styles.heroTitleContainer}>
            <Text style={styles.heroTitle} numberOfLines={2}>
              {s.companyNameStandardized || s.companyNameOriginal || 'Unknown Organization'}
            </Text>
            <View style={styles.uinBadge}>
              <Icon name="identifier" size={moderateScale(12)} color={colors.textMuted} style={{ marginRight: 2 }} />
              <Text style={styles.uin}>{s.uin}</Text>
            </View>
          </View>
        </View>

        <CollapsibleSection title="Basic Information" icon="domain" index={0} defaultExpanded={true}>
          {renderInfoRows(basicInfo)}
        </CollapsibleSection>

        <CollapsibleSection title="Location Details" icon="map-marker-radius-outline" index={1}>
          {renderInfoRows(locationInfo)}
        </CollapsibleSection>

        <CollapsibleSection title="Registration Info" icon="file-document-outline" index={2}>
          {renderInfoRows(registrationInfo)}
        </CollapsibleSection>

        {/* Survey Data (if exists) */}
        {survey && (
          <CollapsibleSection title="Survey Data" icon="clipboard-text-outline" index={3} defaultExpanded={true}>
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
      </ScrollView>

      {/* Fixed Bottom Action Bar */}
      {!isCompleted && (
        <View style={[styles.bottomActionBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          {(() => {
            return (
              <ActionButton 
                primary
                icon="pencil-outline"
                text="Start / Edit Survey"
                onPress={() => navigation.navigate('SurveyForm', { stakeholderId, stakeholder: s, survey })}
              />
            );
          })()}
        </View>
      )}
    </View>
  );
}

function getStatusColor(status: string) {
  const map: Record<string, string> = {
    OPEN: colors.warning,
    CLOSED: colors.success,
  };
  return map[status] || colors.statusPending;
}

const styles = StyleSheet.create({
  mainContainer: { flex: 1, backgroundColor: colors.bgPrimary },
  container: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: moderateScale(140) }, // Extra padding for bottom bar
  
  heroHeader: {
    borderRadius: borderRadius.xl,
    padding: spacing.xl, borderWidth: 1,
    marginBottom: spacing.xxl,
    ...shadows.elevated,
  },
  heroStatusContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  statusIndicator: { width: moderateScale(10), height: moderateScale(10), borderRadius: moderateScale(5), marginRight: spacing.sm },
  statusValue: { fontSize: moderateScale(14), fontWeight: '800', letterSpacing: 1 },
  heroTitleContainer: { marginTop: spacing.xs },
  heroTitle: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.md },
  
  uinBadge: { 
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bgInput, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, 
    borderRadius: borderRadius.full, borderWidth: 1, borderColor: colors.border
  },
  uin: { ...typography.bodySmall, color: colors.textSecondary, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center' },
  sectionIconWrapper: { 
    width: moderateScale(36), height: moderateScale(36), borderRadius: moderateScale(18), 
    backgroundColor: colors.primaryBg, justifyContent: 'center', alignItems: 'center', marginRight: spacing.md 
  },
  sectionTitle: { ...typography.h3, color: colors.textPrimary },
  
  infoCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.xl,
    borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm, overflow: 'hidden',
    ...shadows.card,
  },
  infoRow: { padding: spacing.lg },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  infoLabel: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.xs },
  infoValue: { ...typography.body, color: colors.textPrimary, fontWeight: '500' },
  
  bottomActionBar: { 
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.bgPrimary, 
    paddingHorizontal: spacing.xl, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 20,
  },
  actionPrimary: {
    flexDirection: 'row', justifyContent: 'center', backgroundColor: colors.primary, 
    borderRadius: borderRadius.full, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.md,
    ...shadows.elevated,
  },
  actionIcon: { marginRight: spacing.sm },
  actionPrimaryText: { ...typography.button, color: '#FFF', fontSize: moderateScale(16) },
  
  actionRow: { flexDirection: 'row', gap: spacing.md },
  actionSecondary: {
    flexDirection: 'row', justifyContent: 'center', backgroundColor: colors.bgCard, 
    borderRadius: borderRadius.full, padding: spacing.md, alignItems: 'center', 
    borderWidth: 1, borderColor: colors.border,
    ...shadows.card,
  },
  actionSecondaryText: { ...typography.label, color: colors.primary, fontSize: moderateScale(14) },
});
