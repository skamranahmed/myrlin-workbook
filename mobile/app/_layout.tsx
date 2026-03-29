/**
 * _layout.tsx - Root layout for the Myrlin Mobile app.
 *
 * Responsibilities:
 * 1. Gate the splash screen until custom fonts finish loading (prevents FOUT)
 * 2. Load all 7 font variants (4 Plus Jakarta Sans + 3 JetBrains Mono)
 * 3. Wrap the entire app tree in ThemeProvider from the Myrlin theme system
 * 4. Gate on server store hydration to prevent flash-to-onboarding
 * 5. Redirect to onboarding if no server is paired
 * 6. Render the top-level Stack navigator with (tabs) as the initial route
 */

import { useCallback, useEffect } from 'react';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ThemeProvider } from '@/hooks/useTheme';
import { useThemeStore } from '@/stores/theme-store';
import { useAuthStore } from '@/stores/auth-store';
import { useServerStore } from '@/stores/server-store';
import { fontAssets } from '@/theme/fonts';
import { BiometricGate } from '@/components/BiometricGate';
import { usePushNotifications } from '@/hooks/usePush';
import { useToastStore } from '@/hooks/useToast';
import { Toast } from '@/components/ui/Toast';

/**
 * Singleton QueryClient for TanStack Query.
 * Created at module scope so it persists across re-renders but not across
 * full app restarts. Default staleTime of 5s prevents excessive refetching
 * while SSE events handle cache invalidation for real-time updates.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: 2,
    },
  },
});

export {
  /** Catch any errors thrown by the Layout component */
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  /** Ensure reloading on nested routes keeps a back button */
  initialRouteName: '(tabs)',
};

/**
 * CRITICAL: Must be called at module scope (outside any component).
 * If placed inside useEffect or a component body, the splash screen
 * will auto-hide before fonts load, causing a flash of unstyled text.
 */
SplashScreen.preventAutoHideAsync();

/**
 * RootLayout - App entry point that gates rendering on font and store readiness.
 *
 * Returns null while fonts are loading or the server store is hydrating
 * (splash screen stays visible in both cases). This prevents the flash-to-onboarding
 * bug where a user with stored servers briefly sees the onboarding screen.
 *
 * Once both fonts and hydration are ready, hides splash and renders
 * the themed navigation stack (with auth redirect if no server is paired).
 */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const hasHydrated = useServerStore((s) => s._hasHydrated);

  useEffect(() => {
    // Only hide splash when fonts are ready AND server store has hydrated
    if ((fontsLoaded || fontError) && hasHydrated) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, hasHydrated]);

  // Keep splash visible until both conditions are met
  if ((!fontsLoaded && !fontError) || !hasHydrated) {
    return null;
  }

  return <RootLayoutNav />;
}

/**
 * RootLayoutNav - Wraps the navigation stack in ThemeProvider with auth gating.
 *
 * Reads the active theme from the Zustand store and passes it to
 * ThemeProvider so all descendant screens can access theme via useTheme().
 *
 * If no server is paired (activeServer is null), redirects to the
 * onboarding screen so the user can connect to a Myrlin server.
 */
function RootLayoutNav() {
  const theme = useThemeStore((s) => s.theme);
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const isLocked = useAuthStore((s) => s.isLocked);
  const activeServer = useServerStore((s) => s.getActiveServer());

  // Global toast state
  const toastVisible = useToastStore((s) => s.visible);
  const toastMessage = useToastStore((s) => s.message);
  const toastVariant = useToastStore((s) => s.variant);
  const hideToast = useToastStore((s) => s.hideToast);
  const globalShowToast = useToastStore((s) => s.showToast);

  /**
   * Callback for foreground push notifications.
   * Displays the notification body as an in-app toast so the user
   * sees it without leaving their current screen.
   */
  const handleForegroundNotification = useCallback(
    (_title: string, body: string) => {
      globalShowToast(body, 'info');
    },
    [globalShowToast]
  );

  // Initialize push notifications (once, at root level)
  usePushNotifications(handleForegroundNotification);

  // If no server is paired, redirect to onboarding
  if (!activeServer) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <StatusBar style={theme.isDark ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.colors.base },
            }}
          >
            <Stack.Screen name="(auth)" />
          </Stack>
          <Toast
            visible={toastVisible}
            message={toastMessage}
            variant={toastVariant}
            onDismiss={hideToast}
          />
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <StatusBar style={theme.isDark ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.base },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)" />
        </Stack>
        {biometricEnabled && isLocked && <BiometricGate />}
        <Toast
          visible={toastVisible}
          message={toastMessage}
          variant={toastVariant}
          onDismiss={hideToast}
        />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
