import React from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';

/**
 * CRASH FIX: shown instead of letting the app silently exit when
 * API_BASE_URL is missing (see the comment block in services/api.ts for the
 * full root-cause explanation). This screen exists purely so a misconfigured
 * build is *visibly* broken with an actionable message, rather than just
 * disappearing — which is what made the original bug so hard to diagnose
 * from a release APK with no Metro/logcat access.
 */
export default function ConfigErrorScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>App Not Configured</Text>
        <Text style={styles.message}>
          This build is missing its server address (API_BASE_URL) and cannot
          connect to MahaAtithi. This is a build configuration issue, not a
          problem with your device or login details.
        </Text>
        <Text style={styles.hint}>
          If you are a developer: add API_BASE_URL to mobile/.env before
          building a release. See mobile/.env.example.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  message: { color: '#cfcfe8', fontSize: 15, textAlign: 'center', marginBottom: 16, lineHeight: 22 },
  hint: { color: '#8888aa', fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
