import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Alert, ScrollView, Platform } from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import Geolocation from 'react-native-geolocation-service';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { requestLocationPermission, requestCameraPermission } from '../../utils/permissions';
import { mediaDao } from '../../database';

const PHOTO_CATEGORIES = [
  { key: 'BUILDING_FRONT', label: 'Building Front', icon: '🏢', required: true },
  { key: 'SIGNBOARD', label: 'Signboard', icon: '🪧', required: true },
  { key: 'INTERIOR', label: 'Interior', icon: '🏠', required: true },
  { key: 'STAKEHOLDER', label: 'Stakeholder', icon: '👤', required: true },
  { key: 'ADDITIONAL', label: 'Additional', icon: '📸', required: false },
];

export default function PhotoCaptureScreen({ route, navigation }: any) {
  const { stakeholderId, surveyId } = route.params;
  const [photos, setPhotos] = useState<Record<string, any>>({});

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

    // Get GPS first
    Geolocation.getCurrentPosition(
      async (position) => {
        const result = await launchCamera({
          mediaType: 'photo',
          quality: 1, // Maximum quality
          saveToPhotos: false,
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
              width: asset.width,
              height: asset.height,
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              gpsAccuracy: position.coords.accuracy,
              capturedAt: new Date().toISOString(),
              category,
            },
          }));
        }
      },
      (error) => {
        Alert.alert('GPS Error', 'Enable GPS for photo capture with location metadata');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
  };

  const removePhoto = (category: string) => {
    setPhotos(prev => {
      const updated = { ...prev };
      delete updated[category];
      return updated;
    });
  };

  const capturedCount = Object.keys(photos).length;
  const canProceed = capturedCount >= 4;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>📷 Photo Capture</Text>
        <Text style={styles.subtitle}>
          {capturedCount} of 5 photos captured (min 4 required)
        </Text>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${(capturedCount / 5) * 100}%` }]} />
        </View>
      </View>

      {PHOTO_CATEGORIES.map((cat) => {
        const photo = photos[cat.key];
        return (
          <View key={cat.key} style={styles.photoSlot}>
            <View style={styles.slotHeader}>
              <Text style={styles.slotIcon}>{cat.icon}</Text>
              <View>
                <Text style={styles.slotLabel}>{cat.label}</Text>
                <Text style={styles.slotReq}>{cat.required ? 'Required' : 'Optional'}</Text>
              </View>
              {photo && <Text style={styles.checkmark}>✅</Text>}
            </View>

            {photo ? (
              <View>
                <Image source={{ uri: photo.uri }} style={styles.photoPreview} />
                <View style={styles.photoMeta}>
                  <Text style={styles.metaText}>📍 {photo.latitude?.toFixed(4)}, {photo.longitude?.toFixed(4)}</Text>
                  <Text style={styles.metaText}>🕐 {new Date(photo.capturedAt).toLocaleTimeString()}</Text>
                </View>
                <View style={styles.photoActions}>
                  <TouchableOpacity style={styles.retakeBtn} onPress={() => capturePhoto(cat.key)}>
                    <Text style={styles.retakeBtnText}>🔄 Retake</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.removeBtn} onPress={() => removePhoto(cat.key)}>
                    <Text style={styles.removeBtnText}>🗑 Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={styles.captureBtn} onPress={() => capturePhoto(cat.key)}>
                <Text style={styles.captureBtnText}>📷 Capture {cat.label}</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}

      <TouchableOpacity
        style={[styles.doneBtn, !canProceed && styles.doneBtnDisabled]}
        disabled={!canProceed}
        onPress={async () => {
          try {
            for (const key in photos) {
              const p = photos[key];
              await mediaDao.save({
                surveyId,
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
            Alert.alert('Photos Saved', `${capturedCount} photos saved successfully`);
            navigation.goBack();
          } catch (e) {
            console.error('Failed to save photos to DB', e);
            Alert.alert('Error', 'Failed to save photos to the database.');
          }
        }}
      >
        <Text style={styles.doneBtnText}>
          {canProceed ? '✅ Done — Photos Saved' : `Need ${4 - capturedCount} more photos`}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { padding: spacing.xl, paddingBottom: 100 },
  header: { marginBottom: spacing.xxl },
  title: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.md },
  progressBar: { height: 4, backgroundColor: colors.border, borderRadius: 2 },
  progressFill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
  photoSlot: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.lg, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border,
  },
  slotHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  slotIcon: { fontSize: 28 },
  slotLabel: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  slotReq: { ...typography.caption, color: colors.textMuted },
  checkmark: { marginLeft: 'auto', fontSize: 20 },
  photoPreview: { width: '100%', height: 200, borderRadius: borderRadius.sm, marginBottom: spacing.sm },
  photoMeta: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.sm },
  metaText: { ...typography.bodySmall, color: colors.textMuted },
  photoActions: { flexDirection: 'row', gap: spacing.sm },
  retakeBtn: { flex: 1, padding: spacing.sm, borderRadius: borderRadius.sm, backgroundColor: colors.bgInput, alignItems: 'center' },
  retakeBtnText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  removeBtn: { flex: 1, padding: spacing.sm, borderRadius: borderRadius.sm, backgroundColor: colors.errorBg, alignItems: 'center' },
  removeBtnText: { color: colors.error, fontSize: 13, fontWeight: '600' },
  captureBtn: {
    borderWidth: 2, borderColor: colors.border, borderStyle: 'dashed',
    borderRadius: borderRadius.md, padding: spacing.xxl, alignItems: 'center',
  },
  captureBtnText: { ...typography.button, color: colors.textSecondary },
  doneBtn: { backgroundColor: colors.success, borderRadius: borderRadius.md, padding: spacing.lg, alignItems: 'center', marginTop: spacing.lg },
  doneBtnDisabled: { backgroundColor: colors.statusPending, opacity: 0.5 },
  doneBtnText: { ...typography.button, color: '#FFF' },
});
