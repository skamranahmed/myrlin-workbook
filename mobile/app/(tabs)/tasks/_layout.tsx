/**
 * tasks/_layout.tsx - Stack navigator for task screens.
 *
 * Wraps the task board (index) and task detail ([id]) in a Stack navigator
 * with themed background and slide animation.
 */

import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/useTheme';

/**
 * TasksLayout - Stack navigator with themed screen options.
 *
 * Provides slide-from-right transitions between the board and detail views.
 */
export default function TasksLayout() {
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
