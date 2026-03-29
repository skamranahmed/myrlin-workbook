/**
 * _layout.tsx - Stack layout for the auth screen group.
 *
 * Provides a headerless Stack navigator for auth screens:
 * onboarding, scan-qr, manual-connect, and login.
 * All screens render full-screen without navigation chrome.
 */

import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/useTheme';

/**
 * AuthLayout - Stack navigator for authentication screens.
 *
 * Hides the header for an immersive full-screen experience.
 * Background color follows the active theme's base color.
 */
export default function AuthLayout() {
  const { theme } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.base },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="scan-qr" />
      <Stack.Screen name="manual-connect" />
      <Stack.Screen name="login" />
    </Stack>
  );
}
