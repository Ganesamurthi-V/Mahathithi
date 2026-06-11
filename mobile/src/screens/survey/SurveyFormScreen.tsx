import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, Platform, KeyboardAvoidingView, Animated
} from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import Geolocation from 'react-native-geolocation-service';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { surveyService } from '../../services/api';
import { surveyDao, syncQueueDao } from '../../database';
import NetInfo from '@react-native-community/netinfo';
import { colors, spacing, borderRadius, typography, shadows, animations } from '../../theme';
import { requestLocationPermission } from '../../utils/permissions';

interface SurveyFormData {
  contactPerson: string;
  designation: string;
  mobileNumber: string;
  email: string;
  gstNumber: string;
  organizationType: string;
  website: string;
  remarks: string;
}

const AnimatedInput = ({ field, control, errors, onFocus, onBlur }: any) => {
  const [isFocused, setIsFocused] = useState(false);
  const borderAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(borderAnim, {
      toValue: isFocused ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [isFocused]);

  const borderColor = borderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.border, colors.primary]
  });

  const backgroundColor = borderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.bgInput, colors.bgCard]
  });

  return (
    <View style={styles.inputGroup}>
      <Text style={[styles.label, isFocused && styles.labelFocused, errors[field.name] && styles.labelError]}>
        {field.label}
      </Text>
      <Animated.View style={[
        styles.inputWrapper, 
        { borderColor: errors[field.name] ? colors.error : borderColor, backgroundColor },
        isFocused && !errors[field.name] && shadows.glow
      ]}>
        <Controller
          control={control}
          name={field.name}
          rules={field.required ? { required: `${field.label.replace(' *', '')} is required` } : undefined}
          render={({ field: { onChange, value } }) => (
            <TextInput
              style={styles.input}
              placeholder={field.placeholder}
              placeholderTextColor={colors.textMuted}
              value={value}
              onChangeText={onChange}
              keyboardType={field.keyboardType || 'default'}
              multiline={field.name === 'remarks'}
              numberOfLines={field.name === 'remarks' ? 4 : 1}
              onFocus={() => { setIsFocused(true); onFocus(); }}
              onBlur={() => { setIsFocused(false); onBlur(); }}
            />
          )}
        />
      </Animated.View>
      {errors[field.name] && (
        <Text style={styles.errorText}>⚠️ {errors[field.name]?.message}</Text>
      )}
    </View>
  );
};

export default function SurveyFormScreen({ route, navigation }: any) {
  const { stakeholderId, stakeholder, survey: existingSurvey } = route.params;
  const { user } = useSelector((state: RootState) => state.auth);
  const [gps, setGps] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [completionPercent, setCompletionPercent] = useState(0);

  const { control, handleSubmit, formState: { errors, dirtyFields }, watch } = useForm<SurveyFormData>({
    defaultValues: {
      contactPerson: existingSurvey?.contactPerson || '',
      designation: existingSurvey?.designation || '',
      mobileNumber: existingSurvey?.mobileNumber || '',
      email: existingSurvey?.email || '',
      gstNumber: existingSurvey?.gstNumber || stakeholder?.gstNumber || '',
      organizationType: existingSurvey?.organizationType || '',
      website: existingSurvey?.website || '',
      remarks: existingSurvey?.remarks || '',
    },
  });

  const watchAllFields = watch();

  useEffect(() => {
    // Calculate progress
    const fields = Object.values(watchAllFields);
    const filledFields = fields.filter(v => v && v.length > 0).length;
    let percent = Math.round((filledFields / fields.length) * 100);
    if (gps) percent = Math.min(100, percent + 15);
    setCompletionPercent(percent);
  }, [watchAllFields, gps]);

  // GPS Animation
  const gpsPulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (gpsLoading) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(gpsPulseAnim, { toValue: 1.5, duration: 600, useNativeDriver: true }),
          Animated.timing(gpsPulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      gpsPulseAnim.setValue(1);
      gpsPulseAnim.stopAnimation();
    }
  }, [gpsLoading]);

  const buttonScaleAnim = useRef(new Animated.Value(1)).current;

  // Auto-capture GPS on mount
  useEffect(() => {
    captureGPS();
  }, []);

  const captureGPS = async () => {
    setGpsLoading(true);

    const hasPermission = await requestLocationPermission();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Location permission is required to capture GPS.');
      setGpsLoading(false);
      return;
    }

    Geolocation.getCurrentPosition(
      (position) => {
        setGps({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
        setGpsLoading(false);
      },
      (error) => {
        Alert.alert('GPS Error', 'Could not get location. Please enable GPS and try again.');
        setGpsLoading(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 10000,
        forceRequestLocation: true,
        showLocationDialog: true,
      }
    );
  };

  const onSubmit = async (data: SurveyFormData) => {
    setSaving(true);

    const surveyPayload = {
      id: existingSurvey?.id || `draft_${stakeholderId}`,
      stakeholderId,
      enumeratorId: user!.id,
      ...data,
      latitude: gps?.latitude,
      longitude: gps?.longitude,
      gpsAccuracy: gps?.accuracy,
    };

    try {
      const netState = await NetInfo.fetch();

      if (netState.isConnected) {
        // Online: save to server
        await surveyService.createOrUpdate(surveyPayload);
        Alert.alert('Saved', 'Survey saved to server successfully');
      } else {
        // Offline: save to SQLite
        await surveyDao.save(surveyPayload);
        await syncQueueDao.add('survey', stakeholderId, 'CREATE', surveyPayload);
        Alert.alert('Saved Offline', 'Survey saved locally. It will sync when internet is available.');
      }

      navigation.goBack();
    } catch (e: any) {
      // Fallback to offline
      try {
        await surveyDao.save(surveyPayload);
        await syncQueueDao.add('survey', stakeholderId, 'CREATE', surveyPayload);
        Alert.alert('Saved Offline', 'Could not reach server. Survey saved locally.');
        navigation.goBack();
      } catch (offlineError) {
        Alert.alert('Error', 'Failed to save survey');
      }
    }

    setSaving(false);
  };

  const fields: { name: keyof SurveyFormData; label: string; placeholder: string; required?: boolean; keyboardType?: any }[] = [
    { name: 'contactPerson', label: 'Contact Person Name *', placeholder: 'Full name of contact person', required: true },
    { name: 'designation', label: 'Designation', placeholder: 'e.g., Manager, Owner' },
    { name: 'mobileNumber', label: 'Mobile Number *', placeholder: '10-digit mobile number', required: true, keyboardType: 'phone-pad' },
    { name: 'email', label: 'Email', placeholder: 'email@example.com', keyboardType: 'email-address' },
    { name: 'gstNumber', label: 'GST Number', placeholder: 'GST Number' },
    { name: 'organizationType', label: 'Organization Type', placeholder: 'e.g., Private Ltd, Partnership' },
    { name: 'website', label: 'Website', placeholder: 'www.example.com', keyboardType: 'url' },
    { name: 'remarks', label: 'Remarks', placeholder: 'Additional notes...' },
  ];

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={[styles.progressBar, { width: `${completionPercent}%` }]} />
      </View>

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Stakeholder Info */}
        <View style={styles.stakeholderInfo}>
          <Text style={styles.stakeholderName}>{stakeholder?.companyNameStandardized}</Text>
          <Text style={styles.stakeholderMeta}>{stakeholder?.district} • {stakeholder?.pinCode}</Text>
        </View>

        {/* GPS Section */}
        <View style={styles.gpsCard}>
          <View style={styles.gpsHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.gpsTitle}>📍 GPS Location</Text>
              {gpsLoading && <Animated.View style={[styles.gpsPulse, { transform: [{ scale: gpsPulseAnim }] }]} />}
            </View>
            <TouchableOpacity onPress={captureGPS} disabled={gpsLoading}>
              <Text style={styles.gpsRefresh}>{gpsLoading ? 'Acquiring...' : '🔄 Refresh'}</Text>
            </TouchableOpacity>
          </View>
          {gps ? (
            <View>
              <Text style={styles.gpsCoord}>Lat: {gps.latitude.toFixed(6)}</Text>
              <Text style={styles.gpsCoord}>Lng: {gps.longitude.toFixed(6)}</Text>
              <Text style={styles.gpsAccuracy}>Accuracy: {gps.accuracy.toFixed(1)}m</Text>
            </View>
          ) : (
            <Text style={styles.gpsWaiting}>
              {gpsLoading ? 'Waiting for satellite fix...' : 'GPS not captured. Tap refresh.'}
            </Text>
          )}
        </View>

        {/* Form Fields */}
        <View style={styles.formContainer}>
          {fields.map((field) => (
            <AnimatedInput
              key={field.name}
              field={field}
              control={control}
              errors={errors}
              onFocus={() => {}}
              onBlur={() => {}}
            />
          ))}
        </View>

        {/* Submit */}
        <Animated.View style={{ transform: [{ scale: buttonScaleAnim }], marginTop: spacing.xl }}>
          <TouchableOpacity
            style={[styles.submitButton, saving && styles.submitDisabled]}
            onPress={handleSubmit(onSubmit)}
            onPressIn={() => Animated.spring(buttonScaleAnim, { toValue: 0.95, useNativeDriver: true }).start()}
            onPressOut={() => Animated.spring(buttonScaleAnim, { toValue: 1, useNativeDriver: true }).start()}
            disabled={saving}
            activeOpacity={0.9}
          >
            {saving ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.submitText}>💾 Save Survey</Text>
            )}
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { padding: spacing.xl, paddingBottom: 100 },
  progressContainer: { height: 4, backgroundColor: colors.border },
  progressBar: { height: '100%', backgroundColor: colors.primary },
  stakeholderInfo: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.lg, marginBottom: spacing.xxl, borderWidth: 1, borderColor: colors.border,
    borderLeftWidth: 4, borderLeftColor: colors.primary,
    ...shadows.card,
  },
  stakeholderName: { ...typography.body, fontWeight: '700', color: colors.textPrimary },
  stakeholderMeta: { ...typography.bodySmall, color: colors.textMuted, marginTop: 4 },
  gpsCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.xl, marginBottom: spacing.xxl, borderWidth: 1, borderColor: colors.border,
    ...shadows.card,
  },
  gpsHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md, alignItems: 'center' },
  gpsTitle: { ...typography.label, color: colors.textPrimary },
  gpsPulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  gpsRefresh: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  gpsCoord: { ...typography.body, color: colors.success, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', letterSpacing: 0.5 },
  gpsAccuracy: { ...typography.caption, color: colors.textMuted, marginTop: 6 },
  gpsWaiting: { ...typography.bodySmall, color: colors.warning },
  formContainer: { backgroundColor: colors.bgCard, padding: spacing.lg, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border },
  inputGroup: { marginBottom: spacing.xl },
  label: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
  labelFocused: { color: colors.primary },
  labelError: { color: colors.error },
  inputWrapper: {
    borderWidth: 1, borderRadius: borderRadius.md, overflow: 'hidden',
  },
  input: {
    paddingHorizontal: spacing.lg, paddingVertical: Platform.OS === 'ios' ? spacing.lg : spacing.md,
    color: colors.textPrimary, fontSize: 16,
  },
  errorText: { color: colors.error, fontSize: 12, marginTop: 6, fontWeight: '500' },
  submitButton: {
    backgroundColor: colors.primary, borderRadius: borderRadius.md,
    paddingVertical: 16, alignItems: 'center',
    ...shadows.elevated,
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { ...typography.button, color: '#FFF', fontSize: 16 },
});
