/**
 * more/_layout.tsx - Stack navigator for the More tab screens.
 *
 * Wraps the More menu (index), templates, session-manager, and recent
 * screens in a Stack navigator. Header hidden since screens manage
 * their own headers.
 */

import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/useTheme';

/**
 * MoreLayout - Stack navigator for More tab sub-screens.
 */
export default function MoreLayout() {
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
