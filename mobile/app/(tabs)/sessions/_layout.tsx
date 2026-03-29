/**
 * sessions/_layout.tsx - Stack navigator for session screens.
 *
 * Wraps the session list (index) and session detail ([id]) in a
 * Stack navigator so the detail screen pushes on top of the list.
 * Header is hidden since each screen manages its own header.
 */

import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/useTheme';

/**
 * SessionsLayout - Stack navigator with themed screen options.
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
    />
  );
}
