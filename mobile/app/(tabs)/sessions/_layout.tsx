/**
 * sessions/_layout.tsx - Stack navigator for session screens.
 *
 * Wraps the session list (index), session detail ([id]), and terminal
 * in a Stack navigator. The terminal screen hides both header and tab bar
 * for a full-screen experience.
 */

import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/useTheme';

/**
 * SessionsLayout - Stack navigator with themed screen options.
 *
 * The terminal screen gets explicit options to hide the header
 * and use a slide-from-right animation for consistency.
 */
export default function SessionsLayout() {
  const { theme } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.base },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="terminal" options={{ headerShown: false, animation: 'slide_from_right' }} />
    </Stack>
  );
}
