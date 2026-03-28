/**
 * _layout.tsx - Root layout for the Myrlin Mobile app.
 *
 * Responsibilities:
 * 1. Gate the splash screen until custom fonts finish loading (prevents FOUT)
 * 2. Load all 7 font variants (4 Plus Jakarta Sans + 3 JetBrains Mono)
 * 3. Wrap the entire app tree in ThemeProvider from the Myrlin theme system
 * 4. Render the top-level Stack navigator with (tabs) as the initial route
 */

import { useEffect } from 'react';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { ThemeProvider } from '@/hooks/useTheme';
import { useThemeStore } from '@/stores/theme-store';
import { fontAssets } from '@/theme/fonts';

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
 * RootLayout - App entry point that gates rendering on font readiness.
 *
 * Returns null while fonts are loading (splash screen stays visible).
 * Once fonts are loaded (or an error occurs), hides splash and renders
 * the themed navigation stack.
 */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return <RootLayoutNav />;
}

/**
 * RootLayoutNav - Wraps the navigation stack in ThemeProvider.
 *
 * Reads the active theme from the Zustand store and passes it to
 * ThemeProvider so all descendant screens can access theme via useTheme().
 */
function RootLayoutNav() {
  const theme = useThemeStore((s) => s.theme);

  return (
    <ThemeProvider>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.base },
        }}
      >
        <Stack.Screen name="(tabs)" />
      </Stack>
    </ThemeProvider>
  );
}
