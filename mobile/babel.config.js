module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // NEW-3 FIX: strip all console.* calls from release builds.
  // React Native does NOT remove console.log in production by default —
  // on Android they appear in adb logcat, exposing PII payloads (contactPerson,
  // mobileNumber, email, gstNumber, GPS coordinates) to anyone with USB access
  // or READ_LOGS permission. This plugin surgically removes them at bundle time.
  env: {
    production: {
      plugins: ['transform-remove-console'],
    },
  },
};
