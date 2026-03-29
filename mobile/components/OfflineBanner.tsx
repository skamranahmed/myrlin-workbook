/**
 * OfflineBanner.tsx - Dismissable banner indicating offline state.
 *
 * Renders a horizontal bar below the status bar showing a cloud-offline icon,
 * "You're offline" text, and a pending action count when mutations are queued.
 * Uses Reanimated FadeIn/FadeOut for smooth appearance and disappearance.
 *
 * Only visible when the useOffline hook reports isOffline as true.
 * The banner does not render at all when the device is connected.
 */

import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { useOffline } from '@/hooks/useOffline';
import { fonts } from '@/theme/fonts';

/**
 * OfflineBanner - Displays a visible offline indicator above the tab content.
 *
 * Shows when the device has no network connectivity or the server is unreachable.
 * Includes the number of pending queued mutations if any exist, so the user
 * knows their actions will be synced when connectivity returns.
 *
 * @returns The banner component, or null when online
 */
export function OfflineBanner(): React.JSX.Element | null {
  const { theme } = useTheme();
  const { isOffline, queueLength } = useOffline();

  if (!isOffline) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      style={[styles.container, { backgroundColor: theme.colors.surface0 }]}
    >
      <Ionicons
        name="cloud-offline-outline"
        size={16}
        color={theme.colors.peach}
      />
      <Text style={[styles.text, { color: theme.colors.peach }]}>
        You're offline
      </Text>
      {queueLength > 0 && (
        <View
          style={[styles.badge, { backgroundColor: theme.colors.surface1 }]}
        >
          <Text style={[styles.badgeText, { color: theme.colors.yellow }]}>
            {queueLength} pending {queueLength === 1 ? 'action' : 'actions'}
          </Text>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /** Banner container: horizontal row with centered items */
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 8,
  },
  /** Primary offline text */
  text: {
    fontFamily: fonts.sans.medium,
    fontSize: 13,
  },
  /** Badge container for pending action count */
  badge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  /** Badge text showing pending count */
  badgeText: {
    fontFamily: fonts.sans.medium,
    fontSize: 11,
  },
});
