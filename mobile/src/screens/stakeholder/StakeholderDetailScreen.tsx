import React, { useEffect, useState, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Animated, LayoutAnimation, UIManager, Platform, Modal, TextInput } from 'react-native';
import { stakeholderService, surveyService } from '../../services/api';
import { stakeholderDao, syncQueueDao, surveyDao } from '../../database';
import NetInfo from '@react-native-community/netinfo';
import { useDispatch } from 'react-redux';
import { runAutoSync } from '../../store/slices/syncThunks';
import { AppDispatch } from '../../store';
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
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editData, setEditData] = useState<any>({});
  const insets = useSafeAreaInsets();
  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    loadData();
  }, [stakeholderId]);

  const loadData = async () => {
    try {
      // Offline-First Architecture: Always read stakeholder from SQLite
      let shLocal = await stakeholderDao.getById(stakeholderId);
      setStakeholder(shLocal);
      
      // Offline-First: Load survey from local SQLite first
      const localSurvey = await surveyDao.getByStakeholder(stakeholderId);
      if (localSurvey) {
        setSurvey(mapSurveyCamel(localSurvey));
      }

      // Background refresh: If online, silently check server for updated survey data
      try {
        const netState = await NetInfo.fetch();
        if (netState.isConnected) {
          const svRes = await surveyService.getByStakeholder(stakeholderId);
          if (svRes.data?.data) {
            setSurvey(svRes.data.data);
          }
        }
      } catch (e) {
        // Silently ignore — we already have local data
      }
      
      if (shLocal) {
        setEditData({
          companyNameStandardized: shLocal.companyNameStandardized || '',
          addressLine1: shLocal.addressLine1 || '',
          addressLine2: shLocal.addressLine2 || '',
          city: shLocal.city || '',
          taluka: shLocal.taluka || '',
          village: shLocal.village || '',
          district: shLocal.district || '',
          state: shLocal.state || '',
          pinCode: shLocal.pinCode || '',
          category: shLocal.category || '',
        });
      }
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.error?.message || 'Failed to load stakeholder');
    }
    setLoading(false);
  };

  // Helper to convert snake_case survey row to camelCase
  const mapSurveyCamel = (row: any) => {
    if (!row) return null;
    return {
      contactPerson: row.contact_person ?? row.contactPerson,
      designation: row.designation,
      mobileNumber: row.mobile_number ?? row.mobileNumber,
      email: row.email,
      website: row.website,
      latitude: row.latitude,
      longitude: row.longitude,
      gpsAccuracy: row.gps_accuracy ?? row.gpsAccuracy,
      nearestPoliceStation: row.nearest_police_station ?? row.nearestPoliceStation,
      nearestHealthcareCenter: row.nearest_healthcare_center ?? row.nearestHealthcareCenter,
    };
  };

  const handleSaveEdit = async () => {
    try {
      // 1. Update local DB so UI updates instantly offline
      await stakeholderDao.update(stakeholderId, editData);
      
      // 2. Queue for background sync
      await syncQueueDao.add('stakeholder', stakeholderId, 'UPDATE', editData);
      
      // 3. Trigger sync pipeline
      dispatch(runAutoSync());
      
      // 4. Update local state to reflect changes
      setStakeholder({ ...stakeholder, ...editData });
      setEditModalVisible(false);
      Alert.alert('Success', 'Stakeholder details updated successfully. They will be synced to the server.');
    } catch (err) {
      Alert.alert('Error', 'Failed to save changes.');
    }
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
          <View style={styles.actionRow}>
            <ActionButton 
              icon="pencil-outline"
              text="Edit Details"
              onPress={() => setEditModalVisible(true)}
            />
            <ActionButton 
              primary
              icon="clipboard-text-outline"
              text="Survey"
              onPress={() => navigation.navigate('SurveyForm', { stakeholderId, stakeholder: s, survey })}
            />
          </View>
        </View>
      )}

      {/* Edit Modal */}
      <Modal visible={editModalVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Edit Stakeholder</Text>
            <TouchableOpacity onPress={() => setEditModalVisible(false)} style={styles.modalCloseButton}>
              <Icon name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalBody}>
            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>Organization Name</Text>
              <TextInput style={styles.input} value={editData.companyNameStandardized} onChangeText={t => setEditData({...editData, companyNameStandardized: t})} />
            </View>
            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>Address Line 1</Text>
              <TextInput style={styles.input} value={editData.addressLine1} onChangeText={t => setEditData({...editData, addressLine1: t})} />
            </View>
            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>Address Line 2</Text>
              <TextInput style={styles.input} value={editData.addressLine2} onChangeText={t => setEditData({...editData, addressLine2: t})} />
            </View>
            <View style={styles.rowGroup}>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>City</Text>
                <TextInput style={styles.input} value={editData.city} onChangeText={t => setEditData({...editData, city: t})} />
              </View>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>Taluka</Text>
                <TextInput style={styles.input} value={editData.taluka} onChangeText={t => setEditData({...editData, taluka: t})} />
              </View>
            </View>
            <View style={styles.rowGroup}>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>Village</Text>
                <TextInput style={styles.input} value={editData.village} onChangeText={t => setEditData({...editData, village: t})} />
              </View>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>District</Text>
                <TextInput style={styles.input} value={editData.district} onChangeText={t => setEditData({...editData, district: t})} />
              </View>
            </View>
            <View style={styles.rowGroup}>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>State</Text>
                <TextInput style={styles.input} value={editData.state} onChangeText={t => setEditData({...editData, state: t})} />
              </View>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>PIN Code</Text>
                <TextInput keyboardType="number-pad" style={styles.input} value={editData.pinCode} onChangeText={t => setEditData({...editData, pinCode: t})} />
              </View>
            </View>
            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>Category</Text>
              <TextInput style={styles.input} value={editData.category} onChangeText={t => setEditData({...editData, category: t})} />
            </View>
            <View style={{ height: 100 }} />
          </ScrollView>
          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.saveButton} onPress={handleSaveEdit}>
              <Text style={styles.saveButtonText}>Save Changes</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  
  modalContainer: { flex: 1, backgroundColor: colors.bgPrimary },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { ...typography.h2, color: colors.textPrimary },
  modalCloseButton: { padding: spacing.sm },
  modalBody: { flex: 1, padding: spacing.xl },
  formGroup: { marginBottom: spacing.lg },
  rowGroup: { flexDirection: 'row', gap: spacing.md },
  inputLabel: { ...typography.label, color: colors.textMuted, marginBottom: spacing.xs },
  input: { 
    backgroundColor: colors.bgInput, borderWidth: 1, borderColor: colors.border,
    borderRadius: borderRadius.lg, padding: spacing.md, ...typography.body, color: colors.textPrimary 
  },
  modalFooter: { padding: spacing.xl, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bgPrimary },
  saveButton: { backgroundColor: colors.primary, borderRadius: borderRadius.full, padding: spacing.lg, alignItems: 'center', ...shadows.elevated },
  saveButtonText: { ...typography.button, color: '#FFF' },
});
