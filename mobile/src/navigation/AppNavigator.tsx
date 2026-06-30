import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View, StyleSheet, Text, Animated, TouchableOpacity, Platform, DeviceEventEmitter } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '../store';
import { checkSession, logout } from '../store/slices/authSlice';
import { runAutoSync } from '../store/slices/syncThunks';
import NetInfo from '@react-native-community/netinfo';
import { colors, typography, shadows, spacing } from '../theme';
import { moderateScale, verticalScale } from '../theme/responsive';

// Screens
import LoginScreen from '../screens/auth/LoginScreen';
import DashboardScreen from '../screens/dashboard/DashboardScreen';
import SearchScreen from '../screens/search/SearchScreen';
import StakeholderListScreen from '../screens/stakeholder/StakeholderListScreen';
import StakeholderDetailScreen from '../screens/stakeholder/StakeholderDetailScreen';
import SurveyFormScreen from '../screens/survey/SurveyFormScreen';
import SyncStatusScreen from '../screens/sync/SyncStatusScreen';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Custom Animated Tab Bar Button
const TabBarButton = ({ children, onPress, accessibilityState }: any) => {
  const focused = accessibilityState.selected;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: focused ? 1.15 : 1,
        useNativeDriver: true,
        friction: 5,
        tension: 40,
      }),
      Animated.timing(slideAnim, {
        toValue: focused ? -4 : 0,
        duration: 200,
        useNativeDriver: true,
      })
    ]).start();
  }, [focused]);

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={onPress}
      style={styles.tabButtonContainer}
    >
      <Animated.View style={[styles.tabButton, { transform: [{ scale: scaleAnim }, { translateY: slideAnim }] }]}>
        {children}
      </Animated.View>
    </TouchableOpacity>
  );
};

// Icons map
const TAB_ICONS: Record<string, string> = {
  Dashboard: 'home',
  Search: 'magnify',
  Stakeholders: 'clipboard-list-outline',
  SyncTab: 'sync',
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.bgCard,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? verticalScale(88) : verticalScale(68),
          paddingBottom: Platform.OS === 'ios' ? verticalScale(28) : verticalScale(8),
          paddingTop: verticalScale(8),
          ...shadows.elevated,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: moderateScale(11), fontWeight: '700', marginTop: verticalScale(4) },
        tabBarIcon: ({ focused }) => (
          <Icon name={TAB_ICONS[route.name]} size={moderateScale(24)} color={focused ? colors.primary : colors.textMuted} />
        ),
        tabBarButton: (props) => <TabBarButton {...props} />,
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ tabBarLabel: 'Home' }} />
      <Tab.Screen name="Search" component={SearchScreen} options={{ tabBarLabel: 'Search' }} />
      <Tab.Screen name="Stakeholders" component={StakeholderListScreen} options={{ tabBarLabel: 'List' }} />
      <Tab.Screen name="SyncTab" component={SyncStatusScreen} options={{ tabBarLabel: 'Sync' }} />
    </Tab.Navigator>
  );
}

import InitialSyncModal from '../screens/sync/InitialSyncModal';
import { runInitialSync } from '../store/slices/syncThunks';

export function AppNavigator() {
  const dispatch = useDispatch<AppDispatch>();
  const { isAuthenticated, isLoading } = useSelector((state: RootState) => state.auth);

  useEffect(() => {
    dispatch(checkSession());
  }, [dispatch]);

  // Global listener for forced logouts from interceptors
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('force_logout', () => {
      dispatch(logout() as any);
    });
    return () => sub.remove();
  }, [dispatch]);

  // Global Auto-Sync Listener & Initial Sync Trigger
  useEffect(() => {
    if (!isAuthenticated) return;
    
    // Trigger initial sync check upon login/auth
    dispatch(runInitialSync() as any);

    // SYNC FIX (round 2): debounce reconnect events. runAutoSync() now has
    // its own internal mutex (see syncThunks.ts) so overlapping calls can no
    // longer corrupt the sync_queue — but with flaky connectivity (the
    // "internet cuts multiple times" case), a connect/disconnect/connect
    // flutter can still fire this listener many times in a couple of
    // seconds. Without debouncing, each transition dispatches runAutoSync()
    // immediately; the mutex makes the extras no-ops, but they still cost a
    // NetInfo.fetch() round trip and a Redux dispatch each, and the first one
    // to grab the lock may end up running against a connection that's about
    // to drop again a moment later. Waiting for the connection to be stable
    // for a short window before syncing is both cheaper and more likely to
    // actually complete.
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (state.isConnected) {
        debounceTimer = setTimeout(() => {
          dispatch(runAutoSync() as any);
        }, 1500);
      }
    });
    
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribe();
    };
  }, [dispatch, isAuthenticated]);

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
        headerStyle: { backgroundColor: colors.bgCard },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontWeight: '700', fontSize: moderateScale(18), fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif-medium' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bgPrimary },
        headerBackTitleVisible: false,
      }}
    >
      {!isAuthenticated ? (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      ) : (
        <>
          <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="StakeholderDetail" component={StakeholderDetailScreen}
            options={{ title: 'Details' }} />
          <Stack.Screen name="SurveyForm" component={SurveyFormScreen}
            options={{ title: 'Survey Form' }} />
        </>
      )}
    </Stack.Navigator>
  );
}

// Add the modal wrapper component to inject it globally
export function RootNavigator() {
  return (
    <>
      <AppNavigator />
      <InitialSyncModal />
    </>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bgPrimary,
  },
  tabButtonContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabButton: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});