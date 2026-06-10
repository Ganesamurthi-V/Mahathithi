import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Linking } from 'react-native';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { phoneValidationService } from '../../services/api';
import { colors, spacing, borderRadius, typography } from '../../theme';

export default function PhoneVerificationScreen({ route, navigation }: any) {
  const { stakeholderId, phone } = route.params;
  const { user } = useSelector((state: RootState) => state.auth);
  const [status, setStatus] = useState<'PENDING_VERIFICATION' | 'VERIFIED' | 'FAILED'>('PENDING_VERIFICATION');
  const [callMade, setCallMade] = useState(false);
  const [saving, setSaving] = useState(false);

  const makeCall = () => {
    if (!phone) {
      Alert.alert('No Phone Number', 'Please add a phone number in the survey form first.');
      return;
    }

    // Open Android native dialer
    Linking.openURL(`tel:${phone}`)
      .then(() => setCallMade(true))
      .catch(() => Alert.alert('Error', 'Could not open phone dialer'));
  };

  const saveVerification = async (verificationStatus: 'VERIFIED' | 'FAILED') => {
    setSaving(true);
    try {
      await phoneValidationService.create({
        stakeholderId,
        phoneNumber: phone || 'unknown',
        status: verificationStatus,
        method: 'phone_call',
      });

      setStatus(verificationStatus);
      Alert.alert(
        verificationStatus === 'VERIFIED' ? '✅ Verified' : '❌ Failed',
        verificationStatus === 'VERIFIED'
          ? 'Phone verification recorded successfully'
          : 'Phone verification marked as failed',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (e: any) {
      Alert.alert('Error', 'Failed to save verification. Try again.');
    }
    setSaving(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>📞 Phone Verification</Text>
        <Text style={styles.subtitle}>Call the stakeholder to verify contact information</Text>

        {/* Phone Number */}
        <View style={styles.phoneCard}>
          <Text style={styles.phoneLabel}>PHONE NUMBER</Text>
          <Text style={styles.phoneNumber}>{phone || 'Not provided'}</Text>
        </View>

        {/* Step 1: Make Call */}
        <View style={styles.stepCard}>
          <View style={styles.stepHeader}>
            <Text style={styles.stepNumber}>1</Text>
            <Text style={styles.stepTitle}>Make the Call</Text>
            {callMade && <Text style={styles.checkmark}>✅</Text>}
          </View>
          <TouchableOpacity style={styles.callButton} onPress={makeCall}>
            <Text style={styles.callButtonText}>📞 Call Now</Text>
          </TouchableOpacity>
          <Text style={styles.stepHint}>
            This will open your phone's dialer. After the call, return to this screen.
          </Text>
        </View>

        {/* Step 2: Mark Status */}
        <View style={[styles.stepCard, !callMade && styles.stepDisabled]}>
          <View style={styles.stepHeader}>
            <Text style={styles.stepNumber}>2</Text>
            <Text style={styles.stepTitle}>Mark Verification Status</Text>
          </View>

          {callMade ? (
            <View style={styles.verifyButtons}>
              <TouchableOpacity
                style={[styles.verifyBtn, styles.verifySuccess]}
                onPress={() => saveVerification('VERIFIED')}
                disabled={saving}
              >
                <Text style={styles.verifyBtnIcon}>✅</Text>
                <Text style={styles.verifyBtnText}>Verified</Text>
                <Text style={styles.verifyBtnHint}>Contact confirmed</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.verifyBtn, styles.verifyFailed]}
                onPress={() => saveVerification('FAILED')}
                disabled={saving}
              >
                <Text style={styles.verifyBtnIcon}>❌</Text>
                <Text style={styles.verifyBtnText}>Failed</Text>
                <Text style={styles.verifyBtnHint}>Could not verify</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.stepDisabledText}>Complete Step 1 first</Text>
          )}
        </View>

        {/* Current Status */}
        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>Current Status</Text>
          <Text style={[
            styles.statusValue,
            { color: status === 'VERIFIED' ? colors.success : status === 'FAILED' ? colors.error : colors.warning }
          ]}>
            {status.replace('_', ' ')}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { flex: 1, padding: spacing.xl },
  title: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.xxl },
  phoneCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.xl, marginBottom: spacing.xxl, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center',
  },
  phoneLabel: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm },
  phoneNumber: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, letterSpacing: 1 },
  stepCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.xl, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border,
  },
  stepDisabled: { opacity: 0.5 },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  stepNumber: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary,
    textAlign: 'center', lineHeight: 28, color: '#FFF', fontWeight: '700', fontSize: 14,
  },
  stepTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  checkmark: { fontSize: 18 },
  callButton: {
    backgroundColor: colors.success, borderRadius: borderRadius.md,
    padding: spacing.lg, alignItems: 'center', marginBottom: spacing.sm,
  },
  callButtonText: { ...typography.button, color: '#FFF', fontSize: 18 },
  stepHint: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center' },
  stepDisabledText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  verifyButtons: { flexDirection: 'row', gap: spacing.md },
  verifyBtn: {
    flex: 1, borderRadius: borderRadius.md, padding: spacing.lg, alignItems: 'center',
    borderWidth: 1,
  },
  verifySuccess: { backgroundColor: colors.successBg, borderColor: 'rgba(16,185,129,0.3)' },
  verifyFailed: { backgroundColor: colors.errorBg, borderColor: 'rgba(239,68,68,0.3)' },
  verifyBtnIcon: { fontSize: 28, marginBottom: spacing.sm },
  verifyBtnText: { ...typography.body, fontWeight: '700', color: colors.textPrimary },
  verifyBtnHint: { ...typography.caption, color: colors.textMuted },
  statusCard: {
    backgroundColor: colors.bgCard, borderRadius: borderRadius.md,
    padding: spacing.lg, borderWidth: 1, borderColor: colors.border, alignItems: 'center',
    marginTop: 'auto',
  },
  statusLabel: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.xs },
  statusValue: { fontSize: 18, fontWeight: '700' },
});
