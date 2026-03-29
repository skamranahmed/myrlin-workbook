/**
 * docs/_layout.tsx - Stack navigator for the Docs tab screens.
 *
 * Wraps the docs index and any future nested routes in a Stack
 * navigator. Header hidden since the docs screen manages its own header.
 */

import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/useTheme';

/**
 * DocsLayout - Stack navigator for Docs tab sub-screens.
 */
export default function DocsLayout() {
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
