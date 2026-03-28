/**
 * (tabs)/_layout.tsx - Bottom tab navigator layout.
 *
 * Configures the 5 main app tabs (Sessions, Tasks, Costs, Docs, More)
 * with Catppuccin-themed colors from useTheme(). Each tab uses an icon
 * from @expo/vector-icons/Ionicons and themed header/tab bar styles.
 */

import React, { useMemo } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';

/** Icon name mapping for each tab */
const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  sessions: 'terminal-outline',
  tasks: 'checkbox-outline',
  costs: 'bar-chart-outline',
  docs: 'document-text-outline',
  more: 'ellipsis-horizontal',
};

/**
 * TabLayout - Renders the bottom tab navigator with 5 themed tabs.
 *
 * Uses the MyrlinTheme from context for all colors: tab bar background,
 * active/inactive tints, header background, and header title style.
 */
export default function TabLayout() {
  const { theme } = useTheme();

  const screenOptions = useMemo(
    () => ({
      tabBarActiveTintColor: theme.colors.accent,
      tabBarInactiveTintColor: theme.colors.overlay1,
      tabBarStyle: {
        backgroundColor: theme.colors.mantle,
        borderTopColor: theme.colors.surface0,
        borderTopWidth: 1,
      },
      tabBarLabelStyle: {
        fontFamily: fonts.sans.medium,
        fontSize: 11,
      },
      headerStyle: {
        backgroundColor: theme.colors.base,
      },
      headerTintColor: theme.colors.text,
      headerTitleStyle: {
        fontFamily: fonts.sans.semibold,
        fontSize: theme.typography.sizes.lg,
      },
      headerShadowVisible: false,
    }),
    [theme]
  );

  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen
        name="sessions"
        options={{
          title: 'Sessions',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={TAB_ICONS.sessions} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Tasks',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={TAB_ICONS.tasks} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="costs"
        options={{
          title: 'Costs',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={TAB_ICONS.costs} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="docs"
        options={{
          title: 'Docs',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={TAB_ICONS.docs} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={TAB_ICONS.more} size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
