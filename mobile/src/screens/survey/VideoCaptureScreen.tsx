import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import Geolocation from 'react-native-geolocation-service';
import { Video as VideoCompressor } from 'react-native-compressor';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { requestLocationPermission, requestCameraPermission } from '../../utils/permissions';
import { mediaDao } from '../../database';

export default function VideoCaptureScreen({ route, navigation }: any) {
  const { stakeholderId, surveyId } = route.params;
  const [video, setVideo] = useState<any>(null);
  const [recording, setRecording] = useState(false);
  const [compressing, setCompressing] = useState(false);

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
          videoQuality: 'high',
          durationLimit: 60, // 60 seconds max
          saveToPhotos: false,
        });

        if (result.assets && result.assets[0]) {
          const asset = result.assets[0];
          let finalUri = asset.uri;
          
          setCompressing(true);
          try {
            if (asset.uri) {
              finalUri = await VideoCompressor.compress(
                asset.uri,
                {
                  compressionMethod: 'manual',
                  bitrate: 1500000, // 1.5 Mbps guarantees 60s video stays under 12MB
                }
              );
            }
          } catch (e) {
            console.error('Compression failed', e);
          }
          setCompressing(false);

          setVideo({
            uri: finalUri,
            fileName: asset.fileName,
            fileSize: asset.fileSize, // Original file size, unfortunately compressor doesn't return new size
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

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>🎥 Verification Video</Text>
        <Text style={styles.subtitle}>Record one verification video (~12MB, max 60s)</Text>

        {video ? (
          <View style={styles.videoCard}>
            <View style={styles.videoInfo}>
              <Text style={styles.videoIcon}>🎬</Text>
              <View>
                <Text style={styles.videoName}>{video.fileName || 'video.mp4'}</Text>
                <Text style={styles.videoMeta}>
                  Duration: {video.duration ? `${Math.round(video.duration)}s` : '—'} •
                  Size: {video.fileSize ? `${(video.fileSize / (1024 * 1024)).toFixed(1)}MB` : '—'}
                </Text>
                <Text style={styles.videoMeta}>
                  📍 {video.latitude?.toFixed(4)}, {video.longitude?.toFixed(4)} •
                  🕐 {new Date(video.capturedAt).toLocaleTimeString()}
                </Text>
              </View>
            </View>

            <View style={styles.videoActions}>
              <TouchableOpacity style={styles.retakeBtn} onPress={captureVideo}>
                <Text style={styles.retakeBtnText}>🔄 Re-record</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.removeBtn} onPress={() => setVideo(null)}>
                <Text style={styles.removeBtnText}>🗑 Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={styles.captureBtn} onPress={captureVideo} disabled={recording || compressing}>
            <Text style={styles.captureIcon}>{(recording || compressing) ? '⏳' : '🎥'}</Text>
            <Text style={styles.captureText}>
              {compressing ? 'Compressing Video...' : recording ? 'Opening Camera...' : 'Tap to Record Video'}
            </Text>
            <Text style={styles.captureHint}>Max 60 seconds • ~12MB</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.doneBtn, !video && styles.doneBtnDisabled]}
          disabled={!video}
          onPress={async () => {
            if (!video) return;
            try {
              await mediaDao.save({
                surveyId,
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
              Alert.alert('Video Saved', 'Verification video saved successfully');
              navigation.goBack();
            } catch (e) {
              console.error('Failed to save video to DB', e);
              Alert.alert('Error', 'Failed to save video to the database.');
            }
          }}
        >
          <Text style={styles.doneBtnText}>
            {video ? '✅ Done — Video Saved' : 'Record video to proceed'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { flex: 1, padding: spacing.xl },
  title: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.xxxl },
  captureBtn: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.lg,
    padding: spacing.huge, alignItems: 'center', borderWidth: 2,
    borderColor: colors.border, borderStyle: 'dashed',
  },
  captureIcon: { fontSize: 64, marginBottom: spacing.lg },
  captureText: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },
  captureHint: { ...typography.bodySmall, color: colors.textMuted },
  videoCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.xl, borderWidth: 1, borderColor: colors.success,
    borderLeftWidth: 3,
  },
  videoInfo: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.lg },
  videoIcon: { fontSize: 40 },
  videoName: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  videoMeta: { ...typography.bodySmall, color: colors.textMuted, marginTop: 2 },
  videoActions: { flexDirection: 'row', gap: spacing.md },
  retakeBtn: { flex: 1, padding: spacing.md, borderRadius: borderRadius.sm, backgroundColor: colors.bgInput, alignItems: 'center' },
  retakeBtnText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  removeBtn: { flex: 1, padding: spacing.md, borderRadius: borderRadius.sm, backgroundColor: colors.errorBg, alignItems: 'center' },
  removeBtnText: { color: colors.error, fontSize: 13, fontWeight: '600' },
  doneBtn: { backgroundColor: colors.success, borderRadius: borderRadius.md, padding: spacing.lg, alignItems: 'center', marginTop: 'auto' },
  doneBtnDisabled: { backgroundColor: colors.statusPending, opacity: 0.5 },
  doneBtnText: { ...typography.button, color: '#FFF' },
});
