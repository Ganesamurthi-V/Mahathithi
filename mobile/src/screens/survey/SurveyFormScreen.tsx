import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, Platform, KeyboardAvoidingView, Animated, Image
} from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import Geolocation from 'react-native-geolocation-service';
import { useSelector, useDispatch } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import { surveyDao, mediaDao, facilityDao } from '../../database';
import { refreshSyncCountsThunk, runAutoSync } from '../../store/slices/syncThunks';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { requestLocationPermission, requestCameraPermission } from '../../utils/permissions';
import { launchCamera } from 'react-native-image-picker';
import DocumentPicker from 'react-native-document-picker';
import { Video as VideoCompressor } from 'react-native-compressor';
import Video from 'react-native-video';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Picker } from '@react-native-picker/picker';

interface SurveyFormData {
  businessName: string;
  ownerName: string;
  district: string;
  city: string;
  pinCode: string;
  businessAddress: string;
  mobileNumber: string;
  email: string;
  aadharNumber: string;
  udyamAadharRegNo: string;
  nearestPoliceStation: string;
  nearestHealthcareCenter: string;
}

// ─── Business Category & Sub-category Constants ──────────────────────────────
const BUSINESS_CATEGORIES = [
  'Accommodations',
  'Aqua Tourism',
  'Cuisine',
  'Events and Festivals',
  'Experiences and Activities',
  'Experiences and Activities Slots',
  'Guided Tours',
  'Handicrafts and Souvenirs',
  'Tour Guide',
  'Tour Operator / Travel Agent / DMC',
];

const SUB_CATEGORIES: Record<string, string[]> = {
  'Accommodations': ['Hotel', 'Resort', 'Homestay', 'Guest House', 'Hostel'],
  'Aqua Tourism': ['Scuba Diving', 'Snorkeling', 'Boat Cruise', 'Kayaking', 'Jet Ski / Water Sports'],
  'Cuisine': ['Restaurant', 'Café', 'Street Food', 'Traditional Cuisine', 'Bakery & Sweets'],
  'Events and Festivals': ['Cultural Festival', 'Religious Festival', 'Music & Dance Event', 'Food Festival', 'Seasonal Celebration'],
  'Experiences and Activities': ['Adventure Activities', 'Cultural Experience', 'Wellness & Yoga', 'Nature Experience', 'Photography Experience'],
  'Experiences and Activities Slots': ['Morning Slot', 'Afternoon Slot', 'Evening Slot', 'Full Day Experience', 'Multi-Day Experience'],
  'Guided Tours': ['City Tour', 'Heritage Tour', 'Nature Tour', 'Food Tour', 'Walking Tour'],
  'Handicrafts and Souvenirs': ['Handmade Crafts', 'Textiles & Apparel', 'Jewelry & Accessories', 'Home Décor', 'Local Souvenirs'],
  'Tour Guide': ['Heritage Guide', 'Nature Guide', 'Adventure Guide', 'City Guide', 'Multilingual Guide'],
  'Tour Operator / Travel Agent / DMC': ['Local Tour Operator', 'Domestic Travel Agency', 'International Travel Agency', 'Destination Management Company (DMC)', 'Custom Tour Planner'],
};

const ACCOMMODATION_FACILITIES = [
  'WiFi', 'Pool', 'Spa', 'Pet Friendly', 'Parking', 'Restaurant', 'Bar',
  'Gym', 'Laundry', 'Air Conditioning', 'Room Service', 'Conference Room', 'Airport Shuttle',
];

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const STEP_LABELS = ['Category', 'Business', 'Images', 'Details', 'Rooms', 'Socials', 'Docs', 'Terms'];

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
              {field.prefix && (
                <View style={{ paddingHorizontal: spacing.md, borderRightWidth: 1, borderRightColor: colors.border, justifyContent: 'center' }}>
                  <Text style={{ ...typography.body, color: colors.textPrimary, fontWeight: '600' }}>{field.prefix}</Text>
                </View>
              )}
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
  const dispatch = useDispatch<AppDispatch>();
  const [gps, setGps] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  // GPS FIX: tracks the active watchPosition subscription so it can be cleared
  // on unmount or once we've accepted a fix — react-native-geolocation-service
  // keeps the GPS radio on until clearWatch() is called, which would otherwise
  // drain battery indefinitely after the user leaves this screen.
  const gpsWatchId = useRef<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [completionPercent, setCompletionPercent] = useState(0);
  const [currentStep, setCurrentStep] = useState(1);

  // Media State
  const [photos, setPhotos] = useState<Record<string, any>>({});
  const [video, setVideo] = useState<any>(null);
  const [recording, setRecording] = useState(false);
  const [compressing, setCompressing] = useState(false);

  // ─── Step 1: Category & Type ───────────────────────────────────────────────
  const [selectedCategory, setSelectedCategory] = useState<string>(existingSurvey?.business_category || existingSurvey?.businessCategory || '');
  const [selectedSubCategories, setSelectedSubCategories] = useState<string[]>(
    existingSurvey?.sub_categories ? (typeof existingSurvey.sub_categories === 'string' ? JSON.parse(existingSurvey.sub_categories) : existingSurvey.sub_categories) : []
  );

  // ─── Step 4: Details ───────────────────────────────────────────────────────
  const [description, setDescription] = useState(existingSurvey?.description || '');
  const [accommodationFacilities, setAccommodationFacilities] = useState<string[]>(
    existingSurvey?.accommodation_facilities ? (typeof existingSurvey.accommodation_facilities === 'string' ? JSON.parse(existingSurvey.accommodation_facilities) : existingSurvey.accommodation_facilities) : []
  );
  const [accommodationPolicies, setAccommodationPolicies] = useState(existingSurvey?.accommodation_policies || '');
  const [workingHours, setWorkingHours] = useState<any[]>(
    existingSurvey?.working_hours ? (typeof existingSurvey.working_hours === 'string' ? JSON.parse(existingSurvey.working_hours) : existingSurvey.working_hours) : DAYS_OF_WEEK.map(d => ({ day: d, type: 'open_all_day', from: '', to: '' }))
  );

  // ─── Step 5: Rooms & Pricing ───────────────────────────────────────────────
  const [rooms, setRooms] = useState<any[]>(
    existingSurvey?.rooms ? (typeof existingSurvey.rooms === 'string' ? JSON.parse(existingSurvey.rooms) : existingSurvey.rooms) : []
  );

  // ─── Step 7: Business Documents ────────────────────────────────────────────
  const [aboutBusiness, setAboutBusiness] = useState(existingSurvey?.about_business || '');

  // ─── Step 8: Terms & Conditions ────────────────────────────────────────────
  const [agreedToTerms, setAgreedToTerms] = useState(!!existingSurvey?.agreed_to_terms);
  const [declaredInfoCorrect, setDeclaredInfoCorrect] = useState(!!existingSurvey?.declared_info_correct);
  const [acknowledgedDotLiability, setAcknowledgedDotLiability] = useState(!!existingSurvey?.acknowledged_dot_liability);
  
  const scrollViewRef = useRef<ScrollView>(null);
  const isSubmitSuccessRef = useRef(false);



  useEffect(() => {
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollTo({ y: 0, animated: true });
    }
  }, [currentStep]);

  const { control, handleSubmit, formState: { errors, isDirty }, watch, setValue } = useForm<SurveyFormData>({
    mode: 'onChange',
    defaultValues: {
      businessName: existingSurvey?.business_name || existingSurvey?.businessName || '',
      ownerName: existingSurvey?.owner_name || existingSurvey?.ownerName || '',
      district: existingSurvey?.district || stakeholder?.district || '',
      city: existingSurvey?.city || '',
      pinCode: existingSurvey?.pin_code || existingSurvey?.pinCode || '',
      businessAddress: existingSurvey?.business_address || existingSurvey?.businessAddress || '',
      mobileNumber: existingSurvey?.mobileNumber || existingSurvey?.mobile_number || '',
      email: existingSurvey?.email || '',
      aadharNumber: '', // Never pre-fill for security
      udyamAadharRegNo: existingSurvey?.udyam_aadhar_reg_no || existingSurvey?.udyamAadharRegNo || '',
      nearestPoliceStation: existingSurvey?.nearestPoliceStation || existingSurvey?.nearest_police_station || '',
      nearestHealthcareCenter: existingSurvey?.nearestHealthcareCenter || existingSurvey?.nearest_healthcare_center || '',
    },
  });

  const watchAllFields = watch();

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      // Allow navigation if form was successfully submitted
      if (isSubmitSuccessRef.current) return;

      // Check if user has made any changes
      const hasMedia = Object.keys(photos).length > 0 || video !== null;
      if (!isDirty && !hasMedia && !selectedCategory) return;

      // Prevent default navigation
      e.preventDefault();

      Alert.alert(
        'Discard changes?',
        'You have unsaved changes. Are you sure you want to go back and discard them?',
        [
          { text: 'Keep Editing', style: 'cancel', onPress: () => {} },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ]
      );
    });
    return unsubscribe;
  }, [navigation, isDirty, photos, video]);

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
    // GPS FIX: stop the watch if the user navigates away mid-capture —
    // otherwise the GPS radio stays on and callbacks keep firing into a
    // screen that's no longer mounted.
    return () => {
      if (gpsWatchId.current !== null) {
        Geolocation.clearWatch(gpsWatchId.current);
        gpsWatchId.current = null;
      }
    };
  }, []);

  const autoFillNearestFacilities = async (lat: number, lng: number) => {
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
  };

  // GPS FIX (root cause): the original code called getCurrentPosition() with a
  // single 15s window demanding enableHighAccuracy. Offline (no wifi/cell data
  // for network-assisted positioning), the GPS chip is doing a "cold start" —
  // searching for satellites with no almanac/ephemeris assistance — which
  // routinely takes 30-60+ seconds outdoors and can take even longer indoors.
  // A single 15s all-or-nothing attempt fails this every time it's not near-
  // instant, which is most of the time when offline. That's the GPS Error.
  //
  // Fix: use watchPosition instead of getCurrentPosition. This keeps the GPS
  // radio actively listening rather than making one timed attempt. We accept
  // the FIRST fix that arrives — even a rough one — immediately, so the
  // enumerator isn't blocked waiting for perfection. We then keep the watch
  // open for a short refinement window in case a more accurate fix follows
  // (common right after a cold start, as the chip locks onto more satellites),
  // silently upgrading the stored coordinates if so. The overall timeout
  // before showing an error is generous (60s) to match real cold-start GPS
  // behavior, with a coarse-accuracy fallback if even that doesn't produce a fix.
  //
  // GPS FIX (second form slow / not fetching):
  // Two compounding problems caused GPS to be slow or appear broken on the
  // second and subsequent survey forms in the same session:
  //
  // 1. forceLocationManager: true — On Android this bypasses the Fused Location
  //    Provider (FLP). FLP caches the warm GPS fix from the first form and can
  //    return it in milliseconds. Raw LocationManager ignores that cache and
  //    re-scans from scratch, behaving like a cold start even though the chip
  //    is already warm. Removing this flag lets FLP serve the cached position
  //    instantly on form 2+.
  //
  // 2. No last-known-position seed — captureGPS always started with gpsLoading:
  //    true and waited for a watch callback before updating the UI, even when a
  //    fresh, valid fix was sitting in the OS location cache. Adding a
  //    getLastKnownPosition() call at the top seeds gps state immediately (no
  //    spinner, no wait) while the watch continues running in the background to
  //    refine accuracy. This makes form 2 feel instant: the GPS indicator turns
  //    green before the user even scrolls to the GPS card.
  const captureGPS = async () => {
    setGpsLoading(true);

    const hasPermission = await requestLocationPermission();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Location permission is required to capture GPS.');
      setGpsLoading(false);
      return;
    }

    // Clear any previous watch before starting a new one (e.g. user tapped Retry)
    if (gpsWatchId.current !== null) {
      Geolocation.clearWatch(gpsWatchId.current);
      gpsWatchId.current = null;
    }

    // acceptedFirstFix declared before the cache seed so the seed block can
    // set it to true — preventing the 60s error timeout from firing when the
    // cache already gave us a perfectly good fix.
    let acceptedFirstFix = false;
    let refinementTimer: ReturnType<typeof setTimeout> | null = null;
    let overallTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

    // Seed from OS cache first — this is the key fix for "second form is slow".
    // After form 1, the GPS chip is warm and FLP holds a recent fix. Calling
    // getCurrentPosition with low accuracy + short maximumAge returns that
    // cached fix in <100ms, so the GPS indicator turns green immediately instead
    // of spinning for 30-60s again. We only accept it if it's fresh (≤ 2 min)
    // and plausibly accurate (≤ 200m). The watchPosition below continues in the
    // background to refine further and overwrites with a better fix if one arrives.
    try {
      const lastKnown = await new Promise<any>((resolve, reject) => {
        Geolocation.getCurrentPosition(
          resolve,
          reject,
          {
            enableHighAccuracy: false,   // low-accuracy = FLP cache path, near-instant
            timeout: 2000,               // give up quickly if nothing is cached
            maximumAge: 120000,          // accept fixes up to 2 minutes old
          }
        );
      });
      const ageSec = (Date.now() - lastKnown.timestamp) / 1000;
      if (lastKnown.coords.accuracy <= 200 && ageSec <= 120) {
        // Good enough cached fix — unblock the form immediately.
        const { latitude, longitude, accuracy } = lastKnown.coords;
        setGps({ latitude, longitude, accuracy });
        setGpsLoading(false);
        autoFillNearestFacilities(latitude, longitude);
        // Mark accepted so the 60s error timeout and the watch's first-fix
        // branch both know we already have a valid location.
        acceptedFirstFix = true;
        // Fall through: watchPosition below will refine if a better fix arrives.
      }
    } catch {
      // No cached fix (true cold start on form 1, or cache expired). Normal —
      // just fall through to the watchPosition loop below.
    }

    const stopWatch = () => {
      if (gpsWatchId.current !== null) {
        Geolocation.clearWatch(gpsWatchId.current);
        gpsWatchId.current = null;
      }
      if (refinementTimer) clearTimeout(refinementTimer);
      if (overallTimeoutTimer) clearTimeout(overallTimeoutTimer);
    };

    // Overall safety net: if NO fix at all arrives within 60s (GPS hardware
    // issue, deeply indoors, obstructed sky), surface the error. This is much
    // more realistic than the original 15s for an offline cold start.
    // If the cache seed above already populated gps, the 60s timer is a
    // background refinement window — we won't show an error if it expires,
    // because acceptedFirstFix will already be true from the seed path below.
    overallTimeoutTimer = setTimeout(() => {
      if (!acceptedFirstFix) {
        stopWatch();
        setGpsLoading(false);
        Alert.alert(
          'GPS Error',
          'Could not get a location fix. Move to an open area away from buildings, make sure GPS/Location is enabled, and try again.'
        );
      }
    }, 60000);

    gpsWatchId.current = Geolocation.watchPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy;

        setGps({ latitude: lat, longitude: lng, accuracy });

        if (!acceptedFirstFix) {
          // First fix of any accuracy from the watch — unblock the form if the
          // cache seed above didn't already do so.
          acceptedFirstFix = true;
          setGpsLoading(false);
          autoFillNearestFacilities(lat, lng);

          // Give the chip a further 12s to refine (common right after a cold
          // start as it locks onto more satellites), then stop listening to
          // save battery. Any better fix that arrives in that window silently
          // overwrites the stored coordinates via the same setGps() above.
          refinementTimer = setTimeout(() => {
            stopWatch();
          }, 12000);
        }
      },
      (error) => {
        // Only surface an error if we truly never got any fix — if we already
        // accepted one (either from the cache seed or a prior watch callback),
        // a later watch error shouldn't undo a location the user already has.
        if (!acceptedFirstFix) {
          stopWatch();
          setGpsLoading(false);
          Alert.alert('GPS Error', 'Could not get location. Please enable GPS and try again.');
        }
      },
      {
        enableHighAccuracy: true,
        distanceFilter: 0,
        forceRequestLocation: true,
        showLocationDialog: true,
        // NOTE: forceLocationManager intentionally removed. Setting it true
        // bypasses Android's Fused Location Provider, which caches the warm
        // GPS fix from the previous form and can serve it in milliseconds.
        // Raw LocationManager ignores that cache and rescans from scratch —
        // that's why form 2+ felt like a cold start even with the chip warm.
      }
    );
  };

  // === MEDIA CAPTURE LOGIC ===

  // GPS FIX (round 2): previously this called getCurrentPosition() fresh for
  // every single photo, with the same 15s cold-start timeout problem as the
  // main capture — if GPS hadn't locked yet, the enumerator couldn't take a
  // photo at all. The form already acquires a location fix once via
  // captureGPS() on load; we reuse that here. This is also more correct:
  // every photo/video for one survey visit gets the same consistent
  // coordinates instead of slightly different ones per shot.
  //
  // The fallback path below (used only if `gps` is somehow still null) had
  // its own bug: it used a 20s timeout, while offline cold-start GPS
  // routinely takes 30-60+ seconds — the exact same class of failure the
  // main captureGPS() fix addressed with its 60s window. That mismatch is
  // why "Enable GPS to capture photos" could still fire even with GPS fully
  // enabled and a fix in progress: the fallback gave up too early. The
  // timeout here now matches captureGPS()'s 60s window so a photo taken
  // while the main fix is still settling doesn't fail for the same reason
  // that fix was supposed to prevent. The UI also now disables capture
  // buttons until a fix exists (see disabled={!gps} below), so this
  // fallback should rarely run in practice — it remains only as a safety
  // net for edge cases like a fast double-tap during the gap between the
  // GPS indicator updating and the button's disabled state re-rendering.
  const getLocationForMedia = (): Promise<{ latitude: number; longitude: number; accuracy: number } | null> => {
    if (gps) return Promise.resolve(gps);

    return new Promise((resolve) => {
      let resolved = false;
      const watchId = Geolocation.watchPosition(
        (position) => {
          if (resolved) return;
          resolved = true;
          Geolocation.clearWatch(watchId);
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        () => {
          if (resolved) return;
          resolved = true;
          Geolocation.clearWatch(watchId);
          resolve(null);
        },
        { enableHighAccuracy: true }  // forceLocationManager removed: let FLP serve warm-chip cache on form 2+
      );
      // Matches captureGPS()'s overall timeout — see comment above. Must stay
      // in sync with that value; both reflect the same real-world cold-start
      // ceiling, not an arbitrary UI choice.
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        Geolocation.clearWatch(watchId);
        resolve(null);
      }, 60000);
    });
  };

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

    const location = await getLocationForMedia();
    if (!location) {
      Alert.alert(
        'Still Acquiring Location',
        'GPS hasn\'t locked on yet. This can take up to a minute offline — wait for the green checkmark next to "Location" above, then try again.'
      );
      return;
    }

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
          latitude: location.latitude,
          longitude: location.longitude,
          gpsAccuracy: location.accuracy,
          capturedAt: new Date().toISOString(),
        },
      }));
    }
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

    const location = await getLocationForMedia();
    if (!location) {
      Alert.alert(
        'Still Acquiring Location',
        'GPS hasn\'t locked on yet. This can take up to a minute offline — wait for the green checkmark next to "Location" above, then try again.'
      );
      return;
    }

    setRecording(true);
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
        latitude: location.latitude,
        longitude: location.longitude,
        gpsAccuracy: location.accuracy,
        capturedAt: new Date().toISOString(),
      });
    }
    setRecording(false);
  };

  // === SAVE LOGIC ===

  const saveMediaToDb = async (newSurveyId: string) => {
    for (const key in photos) {
      const p = photos[key];
      await mediaDao.save({
        surveyId: newSurveyId,
        stakeholderId,
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
        stakeholderId,
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
    if (!selectedCategory) {
      Alert.alert('Incomplete Survey', 'Please select a Business Category in Step 1.');
      return;
    }
    const missingPhotos = PHOTO_CATEGORIES.filter(c => c.required && !photos[c.key]);
    if (missingPhotos.length > 0) {
      Alert.alert('Incomplete Survey', `Please capture: ${missingPhotos.map(m => m.label).join(', ')}`);
      return;
    }
    if (!video) {
      Alert.alert('Incomplete Survey', 'Walkthrough Video is required.');
      return;
    }
    if (description.trim().length < 50) {
      Alert.alert('Incomplete Survey', 'Description must be at least 50 characters (Step 4).');
      return;
    }
    if (selectedCategory === 'Accommodations' && rooms.length < 1) {
      Alert.alert('Incomplete Survey', 'At least 1 room is required for Accommodation listings (Step 5).');
      return;
    }
    if (!agreedToTerms || !declaredInfoCorrect || !acknowledgedDotLiability) {
      Alert.alert('Incomplete Survey', 'Please accept all Terms & Conditions in Step 8.');
      return;
    }
    setSaving(true);
    const surveyId = existingSurvey?.id || `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const surveyPayload = {
      id: surveyId,
      stakeholderId,
      enumeratorId: user!.id,
      ...data,
      businessCategory: selectedCategory,
      subCategories: selectedSubCategories,
      latitude: gps?.latitude,
      longitude: gps?.longitude,
      gpsAccuracy: gps?.accuracy,
      // Step 4
      description,
      accommodationFacilities: selectedCategory === 'Accommodations' ? accommodationFacilities : undefined,
      accommodationPolicies: selectedCategory === 'Accommodations' ? accommodationPolicies : undefined,
      workingHours,
      // Step 5
      rooms: selectedCategory === 'Accommodations' ? rooms : undefined,
      // Step 7
      aboutBusiness,
      // Step 8
      agreedToTerms,
      declaredInfoCorrect,
      acknowledgedDotLiability,
      // Sync metadata
      localId: surveyId,
      isDraft: true,
      isCompleted: false,
      isSynced: false,
    };

    try {
      // Save to local SQLite first (offline-first) — this is instant
      await surveyDao.save(surveyPayload);
      await saveMediaToDb(surveyId);
      console.log('💾 [Survey] Saved locally to SQLite.');

      // DON'T mark stakeholder as CLOSED here — that only happens after the
      // server successfully processes complete(). The background sync pipeline
      // (syncThunks → Step C → complete() → removeLockedStakeholders) handles
      // this. Marking it CLOSED prematurely causes mobile/server status mismatch
      // when uploads fail midway.

      // Trigger background sync immediately — don't wait for it
      dispatch(refreshSyncCountsThunk() as any);
      dispatch(runAutoSync() as any);
      // The existing runAutoSync pipeline (triggered by AppNavigator's NetInfo
      // listener or the Sync Center) will pick up the unsynced survey + media
      // and upload everything in the background. No need to block the UI.

      isSubmitSuccessRef.current = true;
      navigation.navigate('Main', { screen: 'Stakeholders' });
      Alert.alert('Survey Saved', 'Your survey has been saved. It will upload automatically in the background.');
    } catch (e: any) {
      console.error('❌ [Survey] Failed to save locally:', e);
      Alert.alert('Error', 'Failed to save survey. Please try again.');
    }
    setSaving(false);
  };

  const nearestFacilityFields = [
    { name: 'nearestPoliceStation' as const, label: 'Nearest Police Station', placeholder: 'Auto-filled based on GPS', isLoading: gpsLoading, isAutocomplete: true, facilityType: 'POLICE_STATION' },
    { name: 'nearestHealthcareCenter' as const, label: 'Nearest Healthcare Center', placeholder: 'Auto-filled based on GPS', isLoading: gpsLoading, isAutocomplete: true, facilityType: 'HEALTHCARE' },
  ];

  // Helper: get visible steps (skip step 5 for non-Accommodation, skip step 6 entirely - no required fields)
  const getVisibleSteps = () => {
    if (selectedCategory === 'Accommodations') return [1, 2, 3, 4, 5, 7, 8];
    return [1, 2, 3, 4, 7, 8]; // skip 5 and 6
  };

  const visibleSteps = getVisibleSteps();
  const currentStepIndex = visibleSteps.indexOf(currentStep);

  const goToNextStep = () => {
    const idx = visibleSteps.indexOf(currentStep);
    if (idx < visibleSteps.length - 1) setCurrentStep(visibleSteps[idx + 1]);
  };

  const goToPrevStep = () => {
    const idx = visibleSteps.indexOf(currentStep);
    if (idx > 0) setCurrentStep(visibleSteps[idx - 1]);
  };

  // Document picker — supports PDF, Word, images, and other document types
  const pickDocument = async (category: string) => {
    try {
      const result = await DocumentPicker.pickSingle({
        type: [
          DocumentPicker.types.pdf,
          DocumentPicker.types.images,
          DocumentPicker.types.doc,
          DocumentPicker.types.docx,
        ],
        copyTo: 'cachesDirectory',
      });
      const location = gps || { latitude: 0, longitude: 0, accuracy: 0 };
      setPhotos(prev => ({
        ...prev,
        [category]: {
          uri: result.fileCopyUri || result.uri,
          fileName: result.name,
          fileSize: result.size,
          type: result.type,
          latitude: location.latitude,
          longitude: location.longitude,
          gpsAccuracy: location.accuracy,
          capturedAt: new Date().toISOString(),
        },
      }));
    } catch (err: any) {
      if (!DocumentPicker.isCancel(err)) {
        Alert.alert('Error', 'Failed to pick document. Please try again.');
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <View style={styles.progressContainer}>
        <View style={[styles.progressBar, { width: `${completionPercent}%`, backgroundColor: completionPercent === 100 ? colors.success : colors.primary }]} />
      </View>

      {/* Breadcrumbs — 8 steps */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.breadcrumbsBar} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm }}>
        {visibleSteps.map((step, idx) => (
          <React.Fragment key={step}>
            <TouchableOpacity 
              style={[styles.stepIndicator, currentStep === step ? styles.stepActive : styles.stepInactive]}
              onPress={() => setCurrentStep(step)}
            >
              <Text style={[styles.stepText, currentStep === step ? styles.stepTextActive : styles.stepTextInactive]}>
                {step}.{STEP_LABELS[step - 1]}
              </Text>
            </TouchableOpacity>
            {idx < visibleSteps.length - 1 && <Icon name="chevron-right" size={14} color={colors.textMuted} style={{ marginHorizontal: 2 }} />}
          </React.Fragment>
        ))}
      </ScrollView>

      <ScrollView ref={scrollViewRef} style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <View style={styles.stakeholderInfo}>
          <Text style={styles.stakeholderName}>{stakeholder?.companyNameStandardized}</Text>
          <Text style={styles.stakeholderMeta}>{stakeholder?.district} • {stakeholder?.pinCode}</Text>
        </View>

        {currentStep === 1 && (
          <View>
            {/* Step 1: Category & Type */}
            <View style={styles.formSection}>
              <Text style={styles.sectionHeader}>Business Category *</Text>
              <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: spacing.md }}>Select one category that best describes your business</Text>
              <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.md, backgroundColor: colors.bgInput }}>
                <Picker
                  selectedValue={selectedCategory}
                  onValueChange={(val) => {
                    setSelectedCategory(val);
                    setSelectedSubCategories([]);
                  }}
                  style={{ color: colors.textPrimary }}
                >
                  <Picker.Item label="-- Select Category --" value="" />
                  {BUSINESS_CATEGORIES.map(cat => (
                    <Picker.Item key={cat} label={cat} value={cat} />
                  ))}
                </Picker>
              </View>

              {selectedCategory !== '' && (
                <>
                  <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>Sub Categories * (max 3)</Text>
                  <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: spacing.md }}>Select up to 3 sub-categories</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    {(SUB_CATEGORIES[selectedCategory] || []).map(sub => {
                      const isSelected = selectedSubCategories.includes(sub);
                      return (
                        <TouchableOpacity
                          key={sub}
                          style={[styles.chipBtn, isSelected && styles.chipBtnActive]}
                          onPress={() => {
                            if (isSelected) {
                              setSelectedSubCategories(prev => prev.filter(s => s !== sub));
                            } else if (selectedSubCategories.length < 3) {
                              setSelectedSubCategories(prev => [...prev, sub]);
                            } else {
                              Alert.alert('Limit Reached', 'Maximum 3 sub-categories allowed.');
                            }
                          }}
                        >
                          <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>{sub}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
            </View>
          </View>
        )}

        {currentStep === 2 && (
          <View>
            {/* Step 2: Basic Information */}
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
                  {gpsLoading ? 'Acquiring location... this can take up to a minute offline' : 'Location required'}
                </Text>
              )}
            </View>

            {/* Business Name & Owner */}
            <View style={styles.formSection}>
              <Text style={styles.sectionHeader}>Business Information</Text>
              <AnimatedInput field={{ name: 'businessName', label: 'Name of Your Business *', placeholder: 'Business name', required: true }} control={control} errors={errors} onFocus={() => {}} onBlur={() => {}} />
              <AnimatedInput field={{ name: 'ownerName', label: 'Owner / Proprietor / Director Name *', placeholder: 'Full name', required: true }} control={control} errors={errors} onFocus={() => {}} onBlur={() => {}} />

              {/* Country & State (read-only) */}
              <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Country</Text>
                  <View style={[styles.inputWrapper, { backgroundColor: colors.bgInput, borderColor: colors.border }]}>
                    <Text style={[styles.input, { color: colors.textMuted }]}>India</Text>
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>State</Text>
                  <View style={[styles.inputWrapper, { backgroundColor: colors.bgInput, borderColor: colors.border }]}>
                    <Text style={[styles.input, { color: colors.textMuted }]}>Maharashtra</Text>
                  </View>
                </View>
              </View>

              {/* District Picker */}
              <AnimatedInput field={{ name: 'district', label: 'District *', placeholder: 'Select district', required: true }} control={control} errors={errors} onFocus={() => {}} onBlur={() => {}} />
              <AnimatedInput field={{ name: 'city', label: 'City *', placeholder: 'City name', required: true }} control={control} errors={errors} onFocus={() => {}} onBlur={() => {}} />

              <AnimatedInput field={{ name: 'pinCode', label: 'Pin / Zip Code *', placeholder: '6-digit pin code', required: true, keyboardType: 'numeric', maxLength: 6 }} control={control} errors={errors} onFocus={() => {}} onBlur={() => {}} />
              <AnimatedInput field={{ name: 'businessAddress', label: 'Business Address *', placeholder: 'Full business address', required: true }} control={control} errors={errors} onFocus={() => {}} onBlur={() => {}} />

              <Text style={styles.sectionHeader}>Contact Details</Text>
              <AnimatedInput field={{ name: 'mobileNumber', label: 'Mobile Number *', placeholder: '10-digit mobile number', required: true, keyboardType: 'phone-pad', maxLength: 10, prefix: '+91', pattern: { value: /^[0-9]{10}$/, message: 'Invalid number' } }} control={control} errors={errors} onFocus={() => {}} onBlur={() => {}} />
              <AnimatedInput field={{ name: 'email', label: 'Email Address *', placeholder: 'email@example.com', required: true, keyboardType: 'email-address' }} control={control} errors={errors} onFocus={() => {}} onBlur={() => {}} />

              <Text style={styles.sectionHeader}>Government IDs & Registrations</Text>
              <AnimatedInput field={{ name: 'aadharNumber', label: 'Aadhar Number *', placeholder: '12-digit number', required: true, keyboardType: 'numeric', maxLength: 12, pattern: { value: /^\d{12}$/, message: 'Must be 12 digits' } }} control={control} errors={errors} onFocus={() => {}} onBlur={() => {}} />
              <AnimatedInput field={{ name: 'udyamAadharRegNo', label: 'Udyam Aadhar Reg. No. *', placeholder: 'Registration number', required: true }} control={control} errors={errors} onFocus={() => {}} onBlur={() => {}} />

              <Text style={styles.sectionHeader}>Nearest Facilities</Text>
              {nearestFacilityFields.map(f => (
                <AutocompleteInput key={f.name} field={f} control={control} errors={errors} onFocus={() => {}} onBlur={() => {}} setValue={setValue} />
              ))}
            </View>
          </View>
        )}

        {currentStep === 3 && (
          <View>
            {/* Step 3: Images & Media */}
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
                          <TouchableOpacity style={[styles.retakeBtn, !gps && styles.captureBtnDisabled]} onPress={() => capturePhoto(cat.key)} disabled={!gps}>
                            <Icon name="camera-retake" size={16} color={colors.textSecondary} />
                            <Text style={styles.retakeBtnText}>Retake</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.removeBtn} onPress={() => { setPhotos(p => { const np = {...p}; delete np[cat.key]; return np; }); }}>
                            <Icon name="delete" size={16} color={colors.error} />
                            <Text style={styles.removeBtnText}>Remove</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity style={[styles.captureBtn, !gps && styles.captureBtnDisabled]} onPress={() => capturePhoto(cat.key)} disabled={!gps}>
                        <Icon name={gps ? 'camera' : 'crosshairs-gps'} size={24} color={colors.textSecondary} />
                        <Text style={styles.captureBtnText}>{gps ? `Capture ${cat.label}` : 'Waiting for GPS lock...'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}

              <Text style={[styles.sectionHeader, { marginTop: spacing.lg }]}>Verification Video</Text>
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
                      <Video source={{ uri: video.uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" controls={true} paused={true} />
                    </View>
                    <View style={styles.photoActions}>
                      <TouchableOpacity style={[styles.retakeBtn, !gps && styles.captureBtnDisabled]} onPress={captureVideo} disabled={!gps}>
                        <Icon name="camera-retake" size={16} color={colors.textSecondary} /><Text style={styles.retakeBtnText}>Retake</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.removeBtn} onPress={() => setVideo(null)}>
                        <Icon name="delete" size={16} color={colors.error} /><Text style={styles.removeBtnText}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity style={[styles.captureBtn, !gps && styles.captureBtnDisabled]} onPress={captureVideo} disabled={recording || compressing || !gps}>
                    <Icon name={compressing ? 'movie-roll' : gps ? 'video' : 'crosshairs-gps'} size={24} color={colors.textSecondary} />
                    <Text style={styles.captureBtnText}>{compressing ? 'Compressing Video...' : recording ? 'Opening Camera...' : !gps ? 'Waiting for GPS lock...' : 'Record Video'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        )}

        {currentStep === 4 && (
          <View style={styles.formSection}>
            <Text style={styles.sectionHeader}>Description * (min 50 chars)</Text>
            <TextInput style={[styles.input, { borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.md, minHeight: 120, textAlignVertical: 'top', padding: spacing.md }]} multiline value={description} onChangeText={setDescription} placeholder="Describe your business (min 50 characters)" placeholderTextColor={colors.textMuted} />
            <Text style={{ ...typography.caption, color: description.length >= 50 ? colors.success : colors.textMuted, marginTop: spacing.xs }}>{description.length}/50 min</Text>
            {selectedCategory === 'Accommodations' && (
              <>
                <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>Accommodation Facilities</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {ACCOMMODATION_FACILITIES.map(fac => { const isChecked = accommodationFacilities.includes(fac); return (
                    <TouchableOpacity key={fac} style={[styles.chipBtn, isChecked && styles.chipBtnActive]} onPress={() => setAccommodationFacilities(prev => isChecked ? prev.filter(f => f !== fac) : [...prev, fac])}>
                      <Text style={[styles.chipText, isChecked && styles.chipTextActive]}>{fac}</Text>
                    </TouchableOpacity>); })}
                </View>
                <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>Accommodation Policies</Text>
                <TextInput style={[styles.input, { borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.md, minHeight: 100, textAlignVertical: 'top', padding: spacing.md }]} multiline value={accommodationPolicies} onChangeText={setAccommodationPolicies} placeholder="Check-in/out, cancellation, refund policies..." placeholderTextColor={colors.textMuted} />
              </>
            )}
            <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>Working Hours</Text>
            {workingHours.map((wh, idx) => (
              <View key={wh.day} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.sm, flexWrap: 'wrap' }}>
                <Text style={{ width: 70, ...typography.bodySmall, color: colors.textPrimary }}>{wh.day.slice(0, 3)}</Text>
                {(['open_all_day', 'closed', 'hours'] as const).map(type => (
                  <TouchableOpacity key={type} style={[styles.chipBtn, { paddingHorizontal: 8, paddingVertical: 4 }, wh.type === type && styles.chipBtnActive]} onPress={() => setWorkingHours(prev => prev.map((w, i) => i === idx ? { ...w, type } : w))}>
                    <Text style={[styles.chipText, { fontSize: 11 }, wh.type === type && styles.chipTextActive]}>{type === 'open_all_day' ? 'Open' : type === 'closed' ? 'Closed' : 'Hours'}</Text>
                  </TouchableOpacity>))}
                {wh.type === 'hours' && (<View style={{ flexDirection: 'row', gap: 4 }}>
                  <TextInput style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 4, width: 55, padding: 4, fontSize: 12, color: colors.textPrimary }} placeholder="09:00" value={wh.from} onChangeText={t => setWorkingHours(prev => prev.map((w, i) => i === idx ? { ...w, from: t } : w))} />
                  <TextInput style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 4, width: 55, padding: 4, fontSize: 12, color: colors.textPrimary }} placeholder="17:00" value={wh.to} onChangeText={t => setWorkingHours(prev => prev.map((w, i) => i === idx ? { ...w, to: t } : w))} />
                </View>)}
              </View>))}
          </View>
        )}

        {currentStep === 5 && selectedCategory === 'Accommodations' && (
          <View style={styles.formSection}>
            <Text style={styles.sectionHeader}>Rooms (min 1 required)</Text>
            {rooms.map((room, idx) => (
              <View key={idx} style={{ marginBottom: spacing.lg, backgroundColor: colors.bgCard, padding: spacing.md, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border }}>
                <TextInput style={[styles.input, { borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: spacing.sm }]} placeholder="Room Name" value={room.name || ''} onChangeText={t => setRooms(prev => prev.map((r, i) => i === idx ? { ...r, name: t } : r))} placeholderTextColor={colors.textMuted} />
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap' }}>
                  {['Single', 'Double', 'Suite', 'Dormitory'].map(type => (
                    <TouchableOpacity key={type} style={[styles.chipBtn, { paddingHorizontal: 8, paddingVertical: 4 }, room.type === type && styles.chipBtnActive]} onPress={() => setRooms(prev => prev.map((r, i) => i === idx ? { ...r, type } : r))}><Text style={[styles.chipText, { fontSize: 11 }, room.type === type && styles.chipTextActive]}>{type}</Text></TouchableOpacity>))}
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <TextInput style={[styles.input, { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 4 }]} placeholder="Max Guests" keyboardType="numeric" value={room.capacity ? room.capacity.toString() : ''} onChangeText={t => setRooms(prev => prev.map((r, i) => i === idx ? { ...r, capacity: t } : r))} placeholderTextColor={colors.textMuted} />
                  <TextInput style={[styles.input, { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 4 }]} placeholder="₹ Price/Night" keyboardType="numeric" value={room.price ? room.price.toString() : ''} onChangeText={t => setRooms(prev => prev.map((r, i) => i === idx ? { ...r, price: t } : r))} placeholderTextColor={colors.textMuted} />
                </View>
                <TouchableOpacity onPress={() => setRooms(prev => prev.filter((_, i) => i !== idx))} style={{ alignSelf: 'flex-end', marginTop: spacing.sm }}><Icon name="delete" size={18} color={colors.error} /></TouchableOpacity>
              </View>))}
            <TouchableOpacity style={styles.captureBtn} onPress={() => setRooms(prev => [...prev, { name: '', type: '', capacity: '', price: '' }])}><Icon name="plus" size={20} color={colors.textSecondary} /><Text style={styles.captureBtnText}>Add Room</Text></TouchableOpacity>
          </View>
        )}

        {currentStep === 7 && (
          <View style={styles.formSection}>
            <Text style={styles.sectionHeader}>About Business *</Text>
            <TextInput style={[styles.input, { borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.md, minHeight: 120, textAlignVertical: 'top', padding: spacing.md }]} multiline value={aboutBusiness} onChangeText={setAboutBusiness} placeholder="History, achievements, brief profile..." placeholderTextColor={colors.textMuted} />
            <Text style={[styles.sectionHeader, { marginTop: spacing.xl }]}>Required Documents</Text>
            {[{ key: 'UDYOG_AADHAR_DOC', label: 'Udyog Aadhar Card' }, { key: 'AADHAR_CARD_DOC', label: 'Aadhar Card' }, { key: 'PAN_CARD_DOC', label: 'PAN Card' }, { key: 'CANCELLED_CHEQUE_DOC', label: 'Cancelled Cheque' }].map(doc => (
              <View key={doc.key} style={{ marginBottom: spacing.md }}>
                <Text style={{ ...typography.body, color: colors.textPrimary, marginBottom: spacing.xs }}>{doc.label} *</Text>
                {photos[doc.key] ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}><Icon name="check-circle" size={20} color={colors.success} /><Text style={{ ...typography.bodySmall, color: colors.success, flex: 1 }}>{photos[doc.key].fileName || 'Uploaded'}</Text><TouchableOpacity onPress={() => setPhotos(p => { const np = {...p}; delete np[doc.key]; return np; })}><Icon name="close-circle" size={18} color={colors.error} /></TouchableOpacity></View>
                ) : (
                  <TouchableOpacity style={[styles.captureBtn, { paddingVertical: spacing.md }]} onPress={() => pickDocument(doc.key)}><Icon name="file-upload" size={20} color={colors.textSecondary} /><Text style={styles.captureBtnText}>Upload {doc.label}</Text></TouchableOpacity>
                )}
              </View>))}
          </View>
        )}

        {currentStep === 8 && (
          <View style={styles.formSection}>
            <Text style={styles.sectionHeader}>Terms & Conditions</Text>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg }} onPress={() => setAgreedToTerms(!agreedToTerms)}><Icon name={agreedToTerms ? 'checkbox-marked' : 'checkbox-blank-outline'} size={24} color={agreedToTerms ? colors.primary : colors.textMuted} /><Text style={{ ...typography.body, color: colors.textPrimary, marginLeft: spacing.sm, flex: 1 }}>I agree to the Terms & Conditions</Text></TouchableOpacity>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg }} onPress={() => setDeclaredInfoCorrect(!declaredInfoCorrect)}><Icon name={declaredInfoCorrect ? 'checkbox-marked' : 'checkbox-blank-outline'} size={24} color={declaredInfoCorrect ? colors.primary : colors.textMuted} /><Text style={{ ...typography.body, color: colors.textPrimary, marginLeft: spacing.sm, flex: 1 }}>I declare that all information provided is true and correct</Text></TouchableOpacity>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg }} onPress={() => setAcknowledgedDotLiability(!acknowledgedDotLiability)}><Icon name={acknowledgedDotLiability ? 'checkbox-marked' : 'checkbox-blank-outline'} size={24} color={acknowledgedDotLiability ? colors.primary : colors.textMuted} /><Text style={{ ...typography.body, color: colors.textPrimary, marginLeft: spacing.sm, flex: 1 }}>I acknowledge that the Department of Tourism (DOT) is not liable for any financial losses</Text></TouchableOpacity>
            <View style={styles.reviewCard}>
              <Text style={styles.reviewTitle}>Completion Review</Text>
              {!gps && <Text style={styles.reviewError}>• GPS Location is missing</Text>}
              {!selectedCategory && <Text style={styles.reviewError}>• Business Category not selected</Text>}
              {description.trim().length < 50 && <Text style={styles.reviewError}>• Description too short ({description.length}/50 min)</Text>}
              {selectedCategory === 'Accommodations' && rooms.length < 1 && <Text style={styles.reviewError}>• At least 1 room required</Text>}
              {!video && <Text style={styles.reviewError}>• Walkthrough Video is missing</Text>}
              {!aboutBusiness && <Text style={styles.reviewError}>• About Business is empty</Text>}
            </View>
            <Animated.View style={{ transform: [{ scale: buttonScaleAnim }], marginTop: spacing.xxl }}>
              <TouchableOpacity style={[styles.submitBtn, (saving || !agreedToTerms || !declaredInfoCorrect || !acknowledgedDotLiability) && styles.submitBtnDisabled]} onPress={handleSubmit(onSubmit)} disabled={saving || !agreedToTerms || !declaredInfoCorrect || !acknowledgedDotLiability}>
                {saving ? (<View style={{ flexDirection: 'row', alignItems: 'center' }}><ActivityIndicator color="#FFF" /><Text style={[styles.submitText, { marginLeft: spacing.md }]}>Saving...</Text></View>) : (<><Icon name="content-save-outline" size={20} color="#FFF" /><Text style={styles.submitText}>Save Survey</Text></>)}
              </TouchableOpacity>
            </Animated.View>
          </View>
        )}
      </ScrollView>

      {/* Bottom Action Bar for Next/Prev */}
      <View style={styles.bottomActionBar}>
        <TouchableOpacity 
          style={[styles.navButton, currentStepIndex === 0 && { opacity: 0 }]} 
          onPress={goToPrevStep}
          disabled={currentStepIndex === 0}
        >
          <Icon name="chevron-left" size={24} color={colors.primary} />
          <Text style={styles.navButtonText}>Back</Text>
        </TouchableOpacity>

        {currentStepIndex < visibleSteps.length - 1 ? (
          <TouchableOpacity 
            style={[styles.navButton, styles.navButtonNext]} 
            onPress={goToNextStep}
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
  content: { padding: spacing.lg, paddingBottom: moderateScale(100) },
  progressContainer: { height: 4, backgroundColor: colors.bgCard, width: '100%' },
  progressBar: { height: 4, backgroundColor: colors.primary },
  stakeholderInfo: { marginBottom: spacing.lg },
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
  sectionHeader: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.md, marginTop: spacing.lg },
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
  // GPS FIX: visual state for capture buttons while no GPS fix exists yet.
  // Prevents the "Enable GPS to capture photos" dead-end by making the wait
  // visible (dimmed + relabeled) instead of letting the user tap through to
  // a 60s timeout. See getLocationForMedia() for the underlying fix.
  captureBtnDisabled: { opacity: 0.5 },
  
  submitBtn: {
    backgroundColor: colors.primary, borderRadius: borderRadius.full, padding: spacing.xl,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: spacing.sm,
    ...shadows.elevated,
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitText: { ...typography.button, color: '#FFF', fontSize: 18 },

  breadcrumbsBar: {
    maxHeight: 44,
    backgroundColor: colors.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
  chipBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: borderRadius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bgInput,
  },
  chipBtnActive: {
    backgroundColor: colors.primaryBg, borderColor: colors.primary,
  },
  chipText: {
    ...typography.bodySmall, color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.primary, fontWeight: '600',
  },
});