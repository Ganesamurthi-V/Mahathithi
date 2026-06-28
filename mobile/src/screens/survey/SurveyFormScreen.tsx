import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, Platform, KeyboardAvoidingView, Animated, Image
} from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import Geolocation from 'react-native-geolocation-service';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { surveyService, mediaService } from '../../services/api';
import { surveyDao, syncQueueDao, mediaDao, facilityDao, stakeholderDao } from '../../database';
import NetInfo from '@react-native-community/netinfo';
import { colors, spacing, borderRadius, typography, shadows, iconSizes } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { requestLocationPermission, requestCameraPermission } from '../../utils/permissions';
import { launchCamera } from 'react-native-image-picker';
import { Video as VideoCompressor } from 'react-native-compressor';
import Video from 'react-native-video';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface SurveyFormData {
  contactPerson: string;
  designation: string;
  mobileNumber: string;
  email: string;
  contactPerson2: string;
  mobileNumber2: string;
  email2: string;
  gstNumber: string;
  organizationType: string;
  website: string;
  remarks: string;
  nearestPoliceStation: string;
  nearestHealthcareCenter: string;
}

const PHOTO_CATEGORIES = [
  { key: 'BUILDING_FRONT', label: 'Building Front', icon: 'office-building', required: true },
  { key: 'SIGNBOARD', label: 'Signboard', icon: 'sign-direction', required: true },
  { key: 'INTERIOR', label: 'Interior', icon: 'home-variant-outline', required: true },
  { key: 'STAKEHOLDER', label: 'Stakeholder', icon: 'account-box-outline', required: true },
  { key: 'ADDITIONAL', label: 'Additional', icon: 'camera-plus-outline', required: false },
];

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
          rules={{
            ...(field.required ? { required: `${field.label.replace(' *', '')} is required` } : {}),
            ...(field.pattern ? { pattern: field.pattern } : {})
          }}
          render={({ field: { onChange, value } }) => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={field.placeholder}
                placeholderTextColor={colors.textMuted}
                value={value}
                onChangeText={onChange}
                keyboardType={field.keyboardType || 'default'}
                maxLength={field.maxLength}
                multiline={field.name === 'remarks'}
                numberOfLines={field.name === 'remarks' ? 4 : 1}
                onFocus={() => { setIsFocused(true); onFocus(); }}
                onBlur={() => { setIsFocused(false); onBlur(); }}
              />
              {field.isLoading && (
                <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: spacing.md }} />
              )}
            </View>
          )}
        />
      </Animated.View>
      {errors[field.name] && (
        <Text style={styles.errorText}><Icon name="alert-circle-outline" size={14} /> {errors[field.name]?.message}</Text>
      )}
    </View>
  );
};

const AutocompleteInput = ({ field, control, errors, onFocus, onBlur, setValue }: any) => {
  const [isFocused, setIsFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
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

  const handleSearch = async (text: string) => {
    if (text.length > 2) {
       const res = await facilityDao.search(text, field.facilityType, 20);
       setSuggestions(res);
    } else {
       setSuggestions([]);
    }
  };

  return (
    <View style={[styles.inputGroup, { zIndex: isFocused ? 10 : 1 }]}>
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
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={field.placeholder}
                placeholderTextColor={colors.textMuted}
                value={value}
                onChangeText={(text) => {
                  onChange(text);
                  handleSearch(text);
                }}
                onFocus={() => { setIsFocused(true); onFocus(); }}
                onBlur={() => { setTimeout(() => setIsFocused(false), 200); onBlur(); }}
              />
              {field.isLoading && (
                <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: spacing.md }} />
              )}
            </View>
          )}
        />
      </Animated.View>
      {errors[field.name] && (
        <Text style={styles.errorText}><Icon name="alert-circle-outline" size={14} /> {errors[field.name]?.message}</Text>
      )}
      {isFocused && suggestions.length > 0 && (
        <View style={styles.suggestionsContainer}>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 200 }}>
            {suggestions.map((s, i) => (
              <TouchableOpacity key={i} style={styles.suggestionItem} onPress={() => {
                setValue(field.name, `${s.name} (${s.district})`);
                setSuggestions([]);
                setIsFocused(false);
              }}>
                <Text style={styles.suggestionText}>{s.name} ({s.district})</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
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
  const [uploadText, setUploadText] = useState('');
  const [completionPercent, setCompletionPercent] = useState(0);
  const [currentStep, setCurrentStep] = useState(1);

  // Media State
  const [photos, setPhotos] = useState<Record<string, any>>({});
  const [video, setVideo] = useState<any>(null);
  const [recording, setRecording] = useState(false);
  const [compressing, setCompressing] = useState(false);

  const { control, handleSubmit, formState: { errors }, watch, setValue } = useForm<SurveyFormData>({
    defaultValues: {
      contactPerson: existingSurvey?.contactPerson || '',
      designation: existingSurvey?.designation || '',
      mobileNumber: existingSurvey?.mobileNumber || '',
      email: existingSurvey?.email || '',
      contactPerson2: existingSurvey?.contactPerson2 || existingSurvey?.contact_person_2 || '',
      mobileNumber2: existingSurvey?.mobileNumber2 || existingSurvey?.mobile_number_2 || '',
      email2: existingSurvey?.email2 || existingSurvey?.email_2 || '',
      gstNumber: existingSurvey?.gstNumber || stakeholder?.gstNumber || '',
      organizationType: existingSurvey?.organizationType || '',
      website: existingSurvey?.website || '',
      remarks: existingSurvey?.remarks || '',
      nearestPoliceStation: existingSurvey?.nearestPoliceStation || existingSurvey?.nearest_police_station || '',
      nearestHealthcareCenter: existingSurvey?.nearestHealthcareCenter || existingSurvey?.nearest_healthcare_center || '',
    },
  });

  const watchAllFields = watch();

  useEffect(() => {
    // Calculate progress
    const fields = Object.values(watchAllFields);
    const filledFields = fields.filter(v => v && v.length > 0).length;
    let basePercent = Math.round((filledFields / fields.length) * 40); // Text fields = 40%
    if (gps) basePercent += 10; // GPS = 10%
    
    // Media progress (50% max)
    const requiredPhotos = PHOTO_CATEGORIES.filter(c => c.required).length;
    const capturedPhotosCount = Object.keys(photos).filter(k => PHOTO_CATEGORIES.find(c => c.key === k)?.required).length;
    const mediaPercent = Math.round(((capturedPhotosCount + (video ? 1 : 0)) / (requiredPhotos + 1)) * 50);

    setCompletionPercent(Math.min(100, basePercent + mediaPercent));
  }, [watchAllFields, gps, photos, video]);

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
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setGps({
          latitude: lat,
          longitude: lng,
          accuracy: position.coords.accuracy,
        });

        // Auto-fill nearest facilities
        try {
          const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
            const p = 0.017453292519943295; // Math.PI / 180
            const c = Math.cos;
            const a = 0.5 - c((lat2 - lat1) * p)/2 + c(lat1 * p) * c(lat2 * p) * (1 - c((lon2 - lon1) * p))/2;
            return 12742 * Math.asin(Math.sqrt(a)); // 2 * R; R = 6371 km
          };

          const policeStations = await facilityDao.getNearest(lat, lng, 'POLICE_STATION');
          if (policeStations.length > 0 && !watchAllFields.nearestPoliceStation) {
             const dist = getDistance(lat, lng, policeStations[0].latitude, policeStations[0].longitude);
             setValue('nearestPoliceStation', `${policeStations[0].name} (${dist.toFixed(1)} km)`);
          } else if (policeStations.length === 0 && !watchAllFields.nearestPoliceStation) {
             setValue('nearestPoliceStation', 'Offline database empty. Please sync first.');
          }

          const healthCenters = await facilityDao.getNearest(lat, lng, 'HEALTHCARE');
          if (healthCenters.length > 0 && !watchAllFields.nearestHealthcareCenter) {
             const dist = getDistance(lat, lng, healthCenters[0].latitude, healthCenters[0].longitude);
             setValue('nearestHealthcareCenter', `${healthCenters[0].name} (${dist.toFixed(1)} km)`);
          } else if (healthCenters.length === 0 && !watchAllFields.nearestHealthcareCenter) {
             setValue('nearestHealthcareCenter', 'Offline database empty. Please sync first.');
          }
        } catch (e) {}

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

  // === MEDIA CAPTURE LOGIC ===

  const capturePhoto = async (category: string) => {
    const hasCameraPermission = await requestCameraPermission();
    if (!hasCameraPermission) {
      Alert.alert('Permission Denied', 'Camera permission is required to take photos.');
      return;
    }
    const hasLocationPermission = await requestLocationPermission();
    if (!hasLocationPermission) {
      Alert.alert('Permission Denied', 'Location permission is required for geotagging photos.');
      return;
    }

    Geolocation.getCurrentPosition(
      async (position) => {
        const result = await launchCamera({
          mediaType: 'photo',
          quality: 0.8,
          saveToPhotos: true,
          includeExtra: true,
        });

        if (result.assets && result.assets[0]) {
          const asset = result.assets[0];
          setPhotos(prev => ({
            ...prev,
            [category]: {
              uri: asset.uri,
              fileName: asset.fileName,
              fileSize: asset.fileSize,
              type: asset.type,
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              gpsAccuracy: position.coords.accuracy,
              capturedAt: new Date().toISOString(),
            },
          }));
        }
      },
      () => Alert.alert('GPS Error', 'Enable GPS for photo capture with location metadata'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
  };

  const captureVideo = async () => {
    const hasCameraPermission = await requestCameraPermission();
    if (!hasCameraPermission) {
      Alert.alert('Permission Denied', 'Camera permission is required to record video.');
      return;
    }
    const hasLocationPermission = await requestLocationPermission();
    if (!hasLocationPermission) {
      Alert.alert('Permission Denied', 'Location permission is required for geotagging videos.');
      return;
    }

    setRecording(true);
    Geolocation.getCurrentPosition(
      async (position) => {
        const result = await launchCamera({
          mediaType: 'video',
          videoQuality: 'low',
          durationLimit: 60,
          saveToPhotos: true,
        });

        if (result.assets && result.assets[0]) {
          const asset = result.assets[0];
          let finalUri = asset.uri;
          setCompressing(true);
          try {
            if (asset.uri) {
              finalUri = await VideoCompressor.compress(asset.uri, {
                compressionMethod: 'auto',
              });
            }
          } catch (e) {
            console.error('Compression failed', e);
          }
          setCompressing(false);

          setVideo({
            uri: finalUri,
            fileName: asset.fileName,
            fileSize: asset.fileSize,
            type: asset.type,
            duration: asset.duration,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            gpsAccuracy: position.coords.accuracy,
            capturedAt: new Date().toISOString(),
          });
        }
        setRecording(false);
      },
      () => {
        Alert.alert('GPS Error', 'Enable GPS for video capture');
        setRecording(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
  };

  // === SAVE LOGIC ===

  const saveMediaToDb = async (newSurveyId: string) => {
    for (const key in photos) {
      const p = photos[key];
      await mediaDao.save({
        surveyId: newSurveyId,
        type: 'PHOTO',
        photoCategory: key,
        filePath: p.uri,
        fileName: p.fileName,
        fileSize: p.fileSize,
        mimeType: p.type,
        latitude: p.latitude,
        longitude: p.longitude,
        gpsAccuracy: p.gpsAccuracy,
        capturedAt: p.capturedAt,
        isSynced: false,
      });
    }
    if (video) {
      await mediaDao.save({
        surveyId: newSurveyId,
        type: 'VIDEO',
        filePath: video.uri,
        fileName: video.fileName,
        fileSize: video.fileSize,
        mimeType: video.type || 'video/mp4',
        latitude: video.latitude,
        longitude: video.longitude,
        gpsAccuracy: video.gpsAccuracy,
        capturedAt: video.capturedAt,
        duration: video.duration,
        isSynced: false,
      });
    }
  };

  const onSubmit = async (data: SurveyFormData) => {
    // === STRICT VALIDATION ===
    if (!gps) {
      Alert.alert('Incomplete Survey', 'GPS Location is required to submit the survey.');
      return;
    }
    const missingPhotos = PHOTO_CATEGORIES.filter(c => c.required && !photos[c.key]);
    if (missingPhotos.length > 0) {
      Alert.alert('Incomplete Survey', `Please capture the following required photos: ${missingPhotos.map(m => m.label).join(', ')}`);
      return;
    }
    if (!video) {
      Alert.alert('Incomplete Survey', 'Walkthrough Verification Video is required to submit the survey.');
      return;
    }

    setSaving(true);
    setUploadText('Saving survey data...');
    const surveyId = existingSurvey?.id || `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const surveyPayload = {
      id: surveyId,
      stakeholderId,
      enumeratorId: user!.id,
      ...data,
      latitude: gps?.latitude,
      longitude: gps?.longitude,
      gpsAccuracy: gps?.accuracy,
    };

    try {
      // Step 1: ALWAYS save to local SQLite first (offline-first)
      await surveyDao.save(surveyPayload);
      await saveMediaToDb(surveyId);
      console.log('💾 [Survey] Saved locally to SQLite.');
      
      // Update local stakeholder status so UI reflects completion immediately
      await stakeholderDao.update(stakeholderId, { status: 'CLOSED' });

      // Step 2: Try to sync to server if online
      const netState = await NetInfo.fetch();
      if (netState.isConnected) {
        try {
          setUploadText('Uploading to server...');
          const response = await surveyService.createOrUpdate(surveyPayload);
          const realSurveyId = response.data?.data?.id || surveyId;

          // Upload media sequentially
          let uploadCount = 0;
          const totalMedia = Object.keys(photos).length + (video ? 1 : 0);

          for (const key in photos) {
            uploadCount++;
            setUploadText(`Uploading Photo ${uploadCount}/${totalMedia}...`);
            const p = photos[key];
            const formData = new FormData();
            formData.append('surveyId', realSurveyId);
            formData.append('type', 'PHOTO');
            formData.append('photoCategory', key);
            if (p.latitude) formData.append('latitude', String(p.latitude));
            if (p.longitude) formData.append('longitude', String(p.longitude));
            if (p.gpsAccuracy) formData.append('gpsAccuracy', String(p.gpsAccuracy));
            formData.append('file', {
              uri: p.uri,
              name: p.fileName,
              type: p.type,
            } as any);
            await mediaService.upload(formData);
          }

          if (video) {
            uploadCount++;
            setUploadText(`Uploading Video ${uploadCount}/${totalMedia}...`);
            const formData = new FormData();
            formData.append('surveyId', realSurveyId);
            formData.append('type', 'VIDEO');
            if (video.latitude) formData.append('latitude', String(video.latitude));
            if (video.longitude) formData.append('longitude', String(video.longitude));
            if (video.gpsAccuracy) formData.append('gpsAccuracy', String(video.gpsAccuracy));
            if (video.duration) formData.append('duration', String(video.duration));
            formData.append('file', {
              uri: video.uri,
              name: video.fileName,
              type: video.type || 'video/mp4',
            } as any);
            await mediaService.upload(formData);
          }

          setUploadText('Finalizing survey...');
          await surveyService.complete(realSurveyId);
          await surveyDao.markSynced(surveyId);
          console.log('✅ [Survey] Synced to server successfully.');

          // Remove from local database immediately after successful sync
          await stakeholderDao.removeLockedStakeholders([stakeholderId]);
          console.log(`🗑️ Removed completed survey and stakeholder ${stakeholderId} from local DB`);

          Alert.alert('Saved', 'Survey and media uploaded successfully');
        } catch (uploadError) {
          // Network upload failed — data is safe locally, queue for background sync
          console.warn('⚠️ [Survey] Server upload failed, queued for background sync.', uploadError);
          await syncQueueDao.add('survey', stakeholderId, 'CREATE', surveyPayload);
          Alert.alert('Saved Locally', 'Survey saved to your device. It will sync automatically when internet is available.');
        }
      } else {
        // Offline — queue for background sync
        await syncQueueDao.add('survey', stakeholderId, 'CREATE', surveyPayload);
        Alert.alert('Saved Offline', 'Survey and media saved locally. They will sync when you are back online.');
      }

      navigation.navigate('Main', { screen: 'Stakeholders' });
    } catch (e: any) {
      console.error('❌ [Survey] Failed to save locally:', e);
      Alert.alert('Error', 'Failed to save survey. Please try again.');
    }
    setSaving(false);
    setUploadText('');
  };

  const fields: { name: keyof SurveyFormData; label: string; placeholder: string; required?: boolean; keyboardType?: any; isLoading?: boolean; isAutocomplete?: boolean; facilityType?: string; pattern?: any; maxLength?: number }[] = [
    { name: 'contactPerson', label: 'Contact Person Name *', placeholder: 'Full name of contact person', required: true },
    { name: 'designation', label: 'Designation', placeholder: 'e.g., Manager, Owner' },
    { name: 'mobileNumber', label: 'Mobile Number *', placeholder: '10-digit mobile number', required: true, keyboardType: 'phone-pad', maxLength: 10, pattern: { value: /^[0-9]{10}$/, message: 'Must be exactly 10 digits' } },
    { name: 'email', label: 'Email', placeholder: 'email@example.com', keyboardType: 'email-address' },
    { name: 'contactPerson2', label: 'Secondary Contact Name', placeholder: 'Optional secondary contact' },
    { name: 'mobileNumber2', label: 'Secondary Mobile Number', placeholder: '10-digit mobile number', keyboardType: 'phone-pad', maxLength: 10, pattern: { value: /^[0-9]{10}$/, message: 'Must be exactly 10 digits' } },
    { name: 'email2', label: 'Secondary Email', placeholder: 'email@example.com', keyboardType: 'email-address' },
    { name: 'nearestPoliceStation', label: 'Nearest Police Station', placeholder: 'Auto-filled based on GPS', isLoading: gpsLoading, isAutocomplete: true, facilityType: 'POLICE_STATION' },
    { name: 'nearestHealthcareCenter', label: 'Nearest Healthcare Center', placeholder: 'Auto-filled based on GPS', isLoading: gpsLoading, isAutocomplete: true, facilityType: 'HEALTHCARE' },
    { name: 'gstNumber', label: 'GST Number', placeholder: 'GST Number' },
    { name: 'organizationType', label: 'Organization Type', placeholder: 'e.g., LLC, Pvt Ltd' },
    { name: 'website', label: 'Website', placeholder: 'https://example.com' },
    { name: 'remarks', label: 'Remarks', placeholder: 'Any additional notes' },
  ];

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <View style={styles.progressContainer}>
        <View style={[styles.progressBar, { width: `${completionPercent}%`, backgroundColor: completionPercent === 100 ? colors.success : colors.primary }]} />
      </View>

      {/* Breadcrumbs */}
      <View style={styles.breadcrumbsContainer}>
        {[1, 2, 3].map((step) => (
          <React.Fragment key={step}>
            <TouchableOpacity 
              style={[styles.stepIndicator, currentStep >= step ? styles.stepActive : styles.stepInactive]}
              onPress={() => setCurrentStep(step)}
            >
              <Text style={[styles.stepText, currentStep >= step ? styles.stepTextActive : styles.stepTextInactive]}>
                {step === 1 ? '1. Details' : step === 2 ? '2. Media' : '3. Review'}
              </Text>
            </TouchableOpacity>
            {step < 3 && <Icon name="chevron-right" size={16} color={colors.textMuted} style={{ marginHorizontal: spacing.xs }} />}
          </React.Fragment>
        ))}
      </View>

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.stakeholderInfo}>
          <Text style={styles.stakeholderName}>{stakeholder?.companyNameStandardized}</Text>
          <Text style={styles.stakeholderMeta}>{stakeholder?.district} • {stakeholder?.pinCode}</Text>
        </View>

        {currentStep === 1 && (
          <View>
            {/* GPS Section */}
            <View style={styles.gpsCard}>
              <View style={styles.gpsHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Icon name="map-marker-radius" size={24} color={gps ? colors.success : colors.warning} />
                  <Text style={styles.gpsTitle}>GPS Location</Text>
                </View>
                {gpsLoading ? (
                  <Animated.View style={{ transform: [{ scale: gpsPulseAnim }] }}>
                    <Icon name="crosshairs-gps" size={24} color={colors.primary} />
                  </Animated.View>
                ) : gps ? (
                  <Icon name="check-circle" size={24} color={colors.success} />
                ) : (
                  <TouchableOpacity onPress={captureGPS} style={styles.gpsRetryBtn}>
                    <Icon name="refresh" size={16} color={colors.textSecondary} />
                    <Text style={styles.gpsRetryText}>Retry</Text>
                  </TouchableOpacity>
                )}
              </View>
              {gps ? (
                <Text style={styles.gpsData}>
                  {gps.latitude.toFixed(6)}, {gps.longitude.toFixed(6)} (±{Math.round(gps.accuracy)}m)
                </Text>
              ) : (
                <Text style={styles.gpsWaiting}>
                  {gpsLoading ? 'Acquiring high accuracy location...' : 'Location required'}
                </Text>
              )}
            </View>

            {/* Form Fields */}
            <View style={styles.formSection}>
              <Text style={styles.sectionHeader}>Contact Information</Text>
              {fields.slice(0, 4).map(f => <AnimatedInput key={f.name} field={f} control={control} errors={errors} onFocus={() => {}} onBlur={() => {}} />)}
              
              <Text style={styles.sectionHeader}>Organization Details</Text>
              {fields.slice(4).map(f => f.isAutocomplete ? (
                <AutocompleteInput key={f.name} field={f} control={control} errors={errors} onFocus={() => {}} onBlur={() => {}} setValue={setValue} />
              ) : (
                <AnimatedInput key={f.name} field={f} control={control} errors={errors} onFocus={() => {}} onBlur={() => {}} />
              ))}
            </View>
          </View>
        )}

        {currentStep === 2 && (
          <View>
            {/* Media Capture Section */}
            <View style={styles.formSection}>
              <Text style={styles.sectionHeader}>Photos</Text>
              {PHOTO_CATEGORIES.map((cat) => {
                const photo = photos[cat.key];
                return (
                  <View key={cat.key} style={styles.photoSlot}>
                    <View style={styles.slotHeader}>
                      <Icon name={cat.icon} size={28} color={photo ? colors.success : colors.primary} />
                      <View style={{ flex: 1, marginLeft: spacing.md }}>
                        <Text style={styles.slotLabel}>{cat.label}</Text>
                        <Text style={styles.slotReq}>{cat.required ? 'Required' : 'Optional'}</Text>
                      </View>
                      {photo && <Icon name="check-circle" size={24} color={colors.success} />}
                    </View>

                    {photo ? (
                      <View>
                        <Image source={{ uri: photo.uri }} style={styles.photoPreview} />
                        <View style={styles.photoActions}>
                          <TouchableOpacity style={styles.retakeBtn} onPress={() => capturePhoto(cat.key)}>
                            <Icon name="camera-retake" size={16} color={colors.textSecondary} />
                            <Text style={styles.retakeBtnText}>Retake</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.removeBtn} onPress={() => {
                            setPhotos(p => { const np = {...p}; delete np[cat.key]; return np; });
                          }}>
                            <Icon name="delete" size={16} color={colors.error} />
                            <Text style={styles.removeBtnText}>Remove</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity style={styles.captureBtn} onPress={() => capturePhoto(cat.key)}>
                        <Icon name="camera" size={24} color={colors.textSecondary} />
                        <Text style={styles.captureBtnText}>Capture {cat.label}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}

              <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>Verification Video</Text>
              <View style={styles.photoSlot}>
                <View style={styles.slotHeader}>
                  <Icon name="video" size={28} color={video ? colors.success : colors.primary} />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={styles.slotLabel}>Walkthrough Video</Text>
                    <Text style={styles.slotReq}>Required (Max 60s)</Text>
                  </View>
                  {video && <Icon name="check-circle" size={24} color={colors.success} />}
                </View>

                {video ? (
                  <View>
                    <View style={{ width: '100%', height: 200, borderRadius: borderRadius.lg, overflow: 'hidden', marginBottom: spacing.md, backgroundColor: '#000' }}>
                      <Video
                        source={{ uri: video.uri }}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="contain"
                        controls={true}
                        paused={true}
                      />
                    </View>
                    <View style={styles.photoActions}>
                      <TouchableOpacity style={styles.retakeBtn} onPress={captureVideo}>
                        <Icon name="camera-retake" size={16} color={colors.textSecondary} />
                        <Text style={styles.retakeBtnText}>Retake</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.removeBtn} onPress={() => setVideo(null)}>
                        <Icon name="delete" size={16} color={colors.error} />
                        <Text style={styles.removeBtnText}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.captureBtn} onPress={captureVideo} disabled={recording || compressing}>
                    <Icon name={compressing ? "movie-roll" : "video"} size={24} color={colors.textSecondary} />
                    <Text style={styles.captureBtnText}>
                      {compressing ? 'Compressing Video...' : recording ? 'Opening Camera...' : 'Record Video'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        )}

        {currentStep === 3 && (
          <View style={styles.formSection}>
            <Text style={styles.sectionHeader}>Review & Submit</Text>
            <View style={styles.reviewCard}>
              <Text style={styles.reviewTitle}>Overall Completion: {completionPercent}%</Text>
              
              {!gps && <Text style={styles.reviewError}>• GPS Location is missing.</Text>}
              
              {fields.filter(f => f.required && (!watchAllFields[f.name] || String(watchAllFields[f.name]).trim() === '')).map(f => (
                <Text key={f.name} style={styles.reviewError}>• Missing Required Info: {f.label.replace(' *', '')}</Text>
              ))}

              {PHOTO_CATEGORIES.filter(c => c.required && !photos[c.key]).map(c => (
                <Text key={c.key} style={styles.reviewError}>• Missing Required Photo: {c.label}</Text>
              ))}

              {!video && <Text style={styles.reviewError}>• Walkthrough Video is missing.</Text>}

              <Text style={styles.reviewNote}>
                Please ensure all required information is captured before saving. Offline surveys will be synced when internet is available.
              </Text>
            </View>

            {/* Submit Button */}
            <Animated.View style={{ transform: [{ scale: buttonScaleAnim }], marginTop: spacing.xxl }}>
              <TouchableOpacity
                style={[styles.submitBtn, saving && styles.submitBtnDisabled]}
                onPress={handleSubmit(onSubmit)}
                disabled={saving}
              >
                {saving ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <ActivityIndicator color="#FFF" />
                    {uploadText ? <Text style={[styles.submitText, { marginLeft: spacing.md }]}>{uploadText}</Text> : null}
                  </View>
                ) : (
                  <>
                    <Icon name="content-save-outline" size={20} color="#FFF" />
                    <Text style={styles.submitText}>Save Survey</Text>
                  </>
                )}
              </TouchableOpacity>
            </Animated.View>
          </View>
        )}
      </ScrollView>

      {/* Bottom Action Bar for Next/Prev */}
      <View style={styles.bottomActionBar}>
        <TouchableOpacity 
          style={[styles.navButton, currentStep === 1 && { opacity: 0 }]} 
          onPress={() => currentStep > 1 && setCurrentStep(currentStep - 1)}
          disabled={currentStep === 1}
        >
          <Icon name="chevron-left" size={24} color={colors.primary} />
          <Text style={styles.navButtonText}>Back</Text>
        </TouchableOpacity>

        {currentStep < 3 ? (
          <TouchableOpacity 
            style={[styles.navButton, styles.navButtonNext]} 
            onPress={() => setCurrentStep(currentStep + 1)}
          >
            <Text style={styles.navButtonNextText}>Next</Text>
            <Icon name="chevron-right" size={24} color="#FFF" />
          </TouchableOpacity>
        ) : (
          <View style={{ flex: 1 }} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { padding: spacing.xl, paddingBottom: moderateScale(100) },
  progressContainer: { height: 4, backgroundColor: colors.bgCard, width: '100%' },
  progressBar: { height: 4, backgroundColor: colors.primary },
  stakeholderInfo: { marginBottom: spacing.xxl },
  stakeholderName: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.xs },
  stakeholderMeta: { ...typography.bodySmall, color: colors.textMuted },
  
  gpsCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.xl,
    padding: spacing.lg, marginBottom: spacing.xxl, borderWidth: 1, borderColor: colors.border,
    ...shadows.card,
  },
  gpsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gpsTitle: { ...typography.h3, color: colors.textPrimary },
  gpsData: { ...typography.bodySmall, color: colors.textSecondary, marginTop: spacing.md },
  gpsWaiting: { ...typography.bodySmall, color: colors.textMuted, marginTop: spacing.md, fontStyle: 'italic' },
  gpsRetryBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgInput, paddingHorizontal: 12, paddingVertical: 6, borderRadius: borderRadius.full },
  gpsRetryText: { ...typography.caption, color: colors.textSecondary, marginLeft: 4 },
  
  formSection: { marginBottom: spacing.xl },
  sectionHeader: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.lg, marginTop: spacing.xl },
  inputGroup: { marginBottom: spacing.lg },
  label: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.xs },
  labelFocused: { color: colors.primary },
  labelError: { color: colors.error },
  inputWrapper: {
    borderWidth: 1, borderRadius: borderRadius.md, overflow: 'hidden',
  },
  input: {
    ...typography.body, color: colors.textPrimary, paddingHorizontal: spacing.lg,
    paddingVertical: Platform.OS === 'ios' ? spacing.lg : spacing.md,
  },
  errorText: { ...typography.caption, color: colors.error, marginTop: spacing.xs },
  suggestionsContainer: {
    position: 'absolute',
    top: 75,
    left: 0,
    right: 0,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    ...shadows.elevated,
    zIndex: 20
  },
  suggestionItem: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  suggestionText: {
    ...typography.body,
    color: colors.textPrimary
  },
  
  photoSlot: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.xl,
    padding: spacing.lg, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border,
  },
  slotHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  slotLabel: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  slotReq: { ...typography.caption, color: colors.textMuted },
  photoPreview: { width: '100%', height: 200, borderRadius: borderRadius.lg, marginBottom: spacing.md },
  videoMetaBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.bgInput, padding: spacing.lg, borderRadius: borderRadius.md, marginBottom: spacing.md },
  videoMetaText: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  photoActions: { flexDirection: 'row', gap: spacing.md },
  retakeBtn: { flex: 1, padding: spacing.md, borderRadius: borderRadius.md, backgroundColor: colors.bgInput, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  retakeBtnText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  removeBtn: { flex: 1, padding: spacing.md, borderRadius: borderRadius.md, backgroundColor: colors.errorBg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  removeBtnText: { color: colors.error, fontSize: 14, fontWeight: '600' },
  captureBtn: {
    borderWidth: 2, borderColor: colors.border, borderStyle: 'dashed',
    borderRadius: borderRadius.lg, padding: spacing.xl, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center', gap: spacing.sm
  },
  captureBtnText: { ...typography.button, color: colors.textSecondary },
  
  submitBtn: {
    backgroundColor: colors.primary, borderRadius: borderRadius.full, padding: spacing.xl,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: spacing.sm,
    ...shadows.elevated,
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitText: { ...typography.button, color: '#FFF', fontSize: 18 },

  breadcrumbsContainer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.md, backgroundColor: colors.bgCard,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  stepIndicator: {
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: borderRadius.full,
  },
  stepActive: {
    backgroundColor: colors.primaryBg,
  },
  stepInactive: {
    backgroundColor: 'transparent',
  },
  stepText: {
    ...typography.label, fontSize: 12, fontWeight: '700',
  },
  stepTextActive: {
    color: colors.primary,
  },
  stepTextInactive: {
    color: colors.textMuted,
  },
  bottomActionBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.lg, backgroundColor: colors.bgCard, borderTopWidth: 1, borderTopColor: colors.border,
    paddingBottom: Platform.OS === 'ios' ? 34 : spacing.lg,
  },
  navButton: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    padding: spacing.md, borderRadius: borderRadius.md,
  },
  navButtonText: {
    ...typography.button, color: colors.primary, fontSize: 16,
  },
  navButtonNext: {
    backgroundColor: colors.primary, paddingHorizontal: spacing.xl, borderRadius: borderRadius.full, ...shadows.elevated
  },
  navButtonNextText: {
    ...typography.button, color: '#FFF', fontSize: 16,
  },
  reviewCard: {
    backgroundColor: colors.bgCard, padding: spacing.xl, borderRadius: borderRadius.xl,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg,
  },
  reviewTitle: {
    ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md,
  },
  reviewError: {
    ...typography.bodySmall, color: colors.error, marginBottom: spacing.xs,
  },
  reviewNote: {
    ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg, fontStyle: 'italic',
  },
});
