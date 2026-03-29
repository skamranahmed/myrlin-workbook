/**
 * ActivityIndicator.tsx - Session activity status label with animated pulse.
 *
 * Displays a compact label showing the session's current activity state.
 * Running sessions show a pulsing green dot next to "Running" text.
 * Other states use static colored text matching their semantic meaning.
 *
 * Uses Reanimated for the pulsing animation and useTheme for colors.
 */

import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, type TextStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import type { Session } from '@/types/api';

interface ActivityIndicatorProps {
  /** Current session status */
  status: Session['status'];
  /** Optional last log message for deriving activity context */
  lastLog?: string;
}

/** Map session status to a display label */
const STATUS_LABELS: Record<Session['status'], string> = {
  running: 'Running',
  idle: 'Idle',
  stopped: 'Stopped',
  error: 'Error',
};

/**
 * ActivityIndicator - Compact label showing session activity state.
 *
 * For running sessions, displays a pulsing green dot with "Running" text.
 * For idle, shows yellow "Idle". For stopped, muted "Stopped". For error, red "Error".
 *
 * @param props - Status and optional last log message
 */
export function ActivityIndicator({ status, lastLog }: ActivityIndicatorProps) {
  const { theme } = useTheme();
  const { colors, animation } = theme;

  // Derive label text from status (could be enhanced with lastLog parsing)
  const label = STATUS_LABELS[status] || 'Unknown';

  // Pulsing opacity for the running dot
  const pulseOpacity = useSharedValue(1);

  useEffect(() => {
    if (status === 'running') {
      pulseOpacity.value = withRepeat(
        withTiming(0.3, {
          duration: animation.slow * 3,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true
      );
    } else {
      pulseOpacity.value = withTiming(1, { duration: animation.fast });
    }
  }, [status, pulseOpacity, animation]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  // Resolve text color based on status
  const textColor = useMemo(() => {
    switch (status) {
      case 'running':
        return colors.green;
      case 'idle':
        return colors.yellow;
      case 'error':
        return colors.red;
      case 'stopped':
        return colors.textMuted;
      default:
        return colors.textSecondary;
    }
  }, [status, colors]);

  const labelStyle = useMemo<TextStyle>(
    () => ({
      color: textColor,
      fontFamily: fonts.sans.medium,
      fontSize: theme.typography.sizes.xs,
    }),
    [textColor, theme.typography.sizes.xs]
  );

  return (
    <View style={styles.container}>
      {status === 'running' ? (
        <Animated.View
          style={[
            styles.dot,
            { backgroundColor: colors.green },
            pulseStyle,
          ]}
        />
      ) : null}
      <Text style={labelStyle}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
