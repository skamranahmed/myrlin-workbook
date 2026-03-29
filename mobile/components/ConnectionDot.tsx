/**
 * ConnectionDot.tsx - Colored status indicator for server connection state.
 *
 * Displays a small colored dot that reflects the current connection status:
 * - green: connected
 * - yellow: connecting (with pulse animation)
 * - red: disconnected
 * - peach: token expired
 *
 * Reads connectionStatus directly from useServerStore. Optionally shows
 * a text label and supports an onPress handler for parent interaction.
 */

import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/useTheme';
import { useServerStore } from '@/stores/server-store';
import { fonts } from '@/theme/fonts';
import type { ConnectionStatus } from '@/types/api';
import type { MyrlinTheme } from '@/theme/types';

/** Dot diameter in pixels */
const DOT_SIZE = 8;

/** Props for the ConnectionDot component */
export interface ConnectionDotProps {
  /** When true, shows a text label next to the dot */
  showLabel?: boolean;
  /** Callback when the dot area is pressed (handled by parent Pressable) */
  onPress?: () => void;
}

/**
 * Human-readable labels for each connection status.
 */
const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  disconnected: 'Offline',
  'token-expired': 'Expired',
};

/**
 * Resolve the dot color from theme based on connection status.
 *
 * @param status - Current connection status
 * @param colors - Theme color tokens
 * @returns Hex color string
 */
function getStatusColor(
  status: ConnectionStatus,
  colors: MyrlinTheme['colors']
): string {
  switch (status) {
    case 'connected':
      return colors.green;
    case 'connecting':
      return colors.yellow;
    case 'disconnected':
      return colors.red;
    case 'token-expired':
      return colors.peach;
  }
}

/**
 * ConnectionDot - Small colored circle indicating server connection health.
 *
 * The dot pulses with a repeating opacity animation when in the 'connecting'
 * state. All other states show a solid dot. Reads connection status directly
 * from the server store for automatic reactivity.
 *
 * @param props - Optional showLabel and onPress
 *
 * @example
 * ```tsx
 * <Pressable onPress={() => setMenuOpen(true)}>
 *   <ConnectionDot showLabel />
 * </Pressable>
 * ```
 */
export function ConnectionDot({ showLabel = false }: ConnectionDotProps) {
  const { theme } = useTheme();
  const connectionStatus = useServerStore((s) => s.connectionStatus);
  const color = getStatusColor(connectionStatus, theme.colors);

  // Pulse animation for 'connecting' state
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (connectionStatus === 'connecting') {
      opacity.value = withRepeat(
        withTiming(0.3, {
          duration: 800,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true
      );
    } else {
      opacity.value = withTiming(1, { duration: theme.animation.fast });
    }
  }, [connectionStatus, opacity, theme.animation]);

  const animatedDotStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const dotStyle = useMemo<ViewStyle>(
    () => ({
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
      backgroundColor: color,
    }),
    [color]
  );

  return (
    <View style={styles.container}>
      <Animated.View style={[dotStyle, animatedDotStyle]} />
      {showLabel && (
        <Text
          style={[
            styles.label,
            {
              color: theme.colors.subtext0,
              fontFamily: fonts.sans.medium,
            },
          ]}
        >
          {STATUS_LABELS[connectionStatus]}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  label: {
    fontSize: 12,
  },
});
