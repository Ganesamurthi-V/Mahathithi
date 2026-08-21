import React, { useEffect } from 'react';
import { LogBox } from 'react-native';
import { Provider } from 'react-redux';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { store } from './store';
import { RootNavigator } from './navigation/AppNavigator';
import { initDatabase } from './database';
import { isApiConfigured } from './services/api';
import ConfigErrorScreen from './screens/ConfigErrorScreen';

// Suppress known deprecation warnings from react-native core that only fire
// because the framework still defines these modules internally. They are not
// imported or used anywhere in our code. Upgrading RN to 0.73+ removes them.
LogBox.ignoreLogs([
  'ProgressBarAndroid has been extracted',
  'Clipboard has been extracted',
  'PushNotificationIOS has been extracted',
]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

export default function App() {
  useEffect(() => {
    initDatabase().catch(console.error);
  }, []);

  // CRASH FIX: bail out to a visible, static screen before mounting any of
  // the app's data-dependent tree (auth, navigation, sync) if the build is
  // missing its server URL. See services/api.ts for the full root-cause
  // writeup of why this used to crash the app on launch instead.
  if (!isApiConfigured) {
    return <ConfigErrorScreen />;
  }

  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <NavigationContainer>
            <RootNavigator />
          </NavigationContainer>
        </SafeAreaProvider>
      </QueryClientProvider>
    </Provider>
  );
}
