import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, Platform,
} from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import Geolocation from 'react-native-geolocation-service';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { surveyService } from '../../services/api';
import { surveyDao, syncQueueDao } from '../../database';
import NetInfo from '@react-native-community/netinfo';
import { colors, spacing, borderRadius, typography } from '../../theme';

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

export default function SurveyFormScreen({ route, navigation }: any) {
  const { stakeholderId, stakeholder, survey: existingSurvey } = route.params;
  const { user } = useSelector((state: RootState) => state.auth);
  const [gps, setGps] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const { control, handleSubmit, formState: { errors } } = useForm<SurveyFormData>({
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

  // Auto-capture GPS on mount
  useEffect(() => {
    captureGPS();
  }, []);

  const captureGPS = () => {
    setGpsLoading(true);
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
        const res = await surveyService.createOrUpdate(surveyPayload);
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Stakeholder Info */}
      <View style={styles.stakeholderInfo}>
        <Text style={styles.stakeholderName}>{stakeholder?.companyNameStandardized}</Text>
        <Text style={styles.stakeholderMeta}>{stakeholder?.district} • {stakeholder?.pinCode}</Text>
      </View>

      {/* GPS Section */}
      <View style={styles.gpsCard}>
        <View style={styles.gpsHeader}>
          <Text style={styles.gpsTitle}>📍 GPS Location</Text>
          <TouchableOpacity onPress={captureGPS} disabled={gpsLoading}>
            <Text style={styles.gpsRefresh}>{gpsLoading ? '...' : '🔄 Refresh'}</Text>
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
            {gpsLoading ? 'Acquiring GPS...' : 'GPS not captured. Tap refresh.'}
          </Text>
        )}
      </View>

      {/* Form Fields */}
      {fields.map((field) => (
        <View key={field.name} style={styles.inputGroup}>
          <Text style={styles.label}>{field.label}</Text>
          <Controller
            control={control}
            name={field.name}
            rules={field.required ? { required: `${field.label.replace(' *', '')} is required` } : undefined}
            render={({ field: { onChange, value } }) => (
              <TextInput
                style={[styles.input, errors[field.name] && styles.inputError]}
                placeholder={field.placeholder}
                placeholderTextColor={colors.textMuted}
                value={value}
                onChangeText={onChange}
                keyboardType={field.keyboardType || 'default'}
                multiline={field.name === 'remarks'}
                numberOfLines={field.name === 'remarks' ? 4 : 1}
              />
            )}
          />
          {errors[field.name] && (
            <Text style={styles.errorText}>{errors[field.name]?.message}</Text>
          )}
        </View>
      ))}

      {/* Submit */}
      <TouchableOpacity
        style={[styles.submitButton, saving && styles.submitDisabled]}
        onPress={handleSubmit(onSubmit)}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.submitText}>💾 Save Survey</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { padding: spacing.xl, paddingBottom: 100 },
  stakeholderInfo: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.lg, marginBottom: spacing.xxl, borderWidth: 1, borderColor: colors.border,
    borderLeftWidth: 3, borderLeftColor: colors.primary,
  },
  stakeholderName: { ...typography.body, fontWeight: '700', color: colors.textPrimary },
  stakeholderMeta: { ...typography.bodySmall, color: colors.textMuted, marginTop: 4 },
  gpsCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.lg, marginBottom: spacing.xxl, borderWidth: 1, borderColor: colors.border,
  },
  gpsHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  gpsTitle: { ...typography.label, color: colors.textPrimary },
  gpsRefresh: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  gpsCoord: { ...typography.body, color: colors.success, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  gpsAccuracy: { ...typography.bodySmall, color: colors.textMuted, marginTop: 4 },
  gpsWaiting: { ...typography.bodySmall, color: colors.warning },
  inputGroup: { marginBottom: spacing.xl },
  label: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.bgInput, borderWidth: 1, borderColor: colors.border,
    borderRadius: borderRadius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    color: colors.textPrimary, fontSize: 15,
  },
  inputError: { borderColor: colors.error },
  errorText: { color: colors.error, fontSize: 12, marginTop: 4 },
  submitButton: {
    backgroundColor: colors.primary, borderRadius: borderRadius.md,
    paddingVertical: 16, alignItems: 'center', marginTop: spacing.lg,
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { ...typography.button, color: '#FFF' },
});
