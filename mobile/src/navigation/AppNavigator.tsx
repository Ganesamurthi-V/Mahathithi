import React, { useEffect } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '../store';
import { checkSession } from '../store/slices/authSlice';
import { colors } from '../theme';

// Screens
import LoginScreen from '../screens/auth/LoginScreen';
import DashboardScreen from '../screens/dashboard/DashboardScreen';
import SearchScreen from '../screens/search/SearchScreen';
import StakeholderListScreen from '../screens/stakeholder/StakeholderListScreen';
import StakeholderDetailScreen from '../screens/stakeholder/StakeholderDetailScreen';
import SurveyFormScreen from '../screens/survey/SurveyFormScreen';
import PhotoCaptureScreen from '../screens/survey/PhotoCaptureScreen';
import VideoCaptureScreen from '../screens/survey/VideoCaptureScreen';
import PhoneVerificationScreen from '../screens/survey/PhoneVerificationScreen';
import SyncStatusScreen from '../screens/sync/SyncStatusScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.bgSecondary,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen}
        options={{ tabBarLabel: 'Dashboard', tabBarIcon: () => null }} />
      <Tab.Screen name="Search" component={SearchScreen}
        options={{ tabBarLabel: 'Search', tabBarIcon: () => null }} />
      <Tab.Screen name="Stakeholders" component={StakeholderListScreen}
        options={{ tabBarLabel: 'List', tabBarIcon: () => null }} />
      <Tab.Screen name="SyncTab" component={SyncStatusScreen}
        options={{ tabBarLabel: 'Sync', tabBarIcon: () => null }} />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  const dispatch = useDispatch<AppDispatch>();
  const { isAuthenticated, isLoading } = useSelector((state: RootState) => state.auth);

  useEffect(() => {
    dispatch(checkSession());
  }, [dispatch]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgSecondary },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.bgPrimary },
      }}
    >
      {!isAuthenticated ? (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      ) : (
        <>
          <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="StakeholderDetail" component={StakeholderDetailScreen}
            options={{ title: 'Stakeholder Details' }} />
          <Stack.Screen name="SurveyForm" component={SurveyFormScreen}
            options={{ title: 'Survey Form' }} />
          <Stack.Screen name="PhotoCapture" component={PhotoCaptureScreen}
            options={{ title: 'Capture Photos' }} />
          <Stack.Screen name="VideoCapture" component={VideoCaptureScreen}
            options={{ title: 'Record Video' }} />
          <Stack.Screen name="PhoneVerification" component={PhoneVerificationScreen}
            options={{ title: 'Phone Verification' }} />
        </>
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bgPrimary,
  },
});
