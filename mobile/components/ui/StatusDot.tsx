/**
 * StatusDot.tsx - Circular status indicator with animated pulse.
 *
 * Displays a colored dot representing session/process status.
 * Running status pulses using Reanimated opacity animation.
 */

import React, { useEffect, useMemo } from 'react';
import { type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/useTheme';
import type { MyrlinTheme } from '@/theme/types';

/** Possible status values */
export type StatusType = 'running' | 'stopped' | 'error' | 'idle';

/** Size presets for the dot */
export type StatusDotSize = 'sm' | 'md';

export interface StatusDotProps {
  /** Current status */
  status: StatusType;
  /** Dot size */
  size?: StatusDotSize;
}

/** Pixel sizes for each size preset */
const SIZES: Record<StatusDotSize, number> = {
  sm: 8,
  md: 12,
};

/**
 * Resolves dot color from theme based on status.
 *
 * @param status - Current status
 * @param colors - Theme color tokens
 * @returns Color string
 */
function getStatusColor(
  status: StatusType,
  colors: MyrlinTheme['colors']
): string {
  switch (status) {
    case 'running':
      return colors.green;
    case 'stopped':
      return colors.overlay1;
    case 'error':
      return colors.red;
    case 'idle':
      return colors.yellow;
  }
}

/**
 * StatusDot - Circular indicator with pulse animation for running status.
 *
 * @param props - StatusDot configuration
 */
export function StatusDot({ status, size = 'md' }: StatusDotProps) {
  const { theme } = useTheme();
  const color = getStatusColor(status, theme.colors);
  const dotSize = SIZES[size];

  const opacity = useSharedValue(1);

  useEffect(() => {
    if (status === 'running') {
      opacity.value = withRepeat(
        withTiming(0.4, {
          duration: theme.animation.slow * 3,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true
      );
    } else {
      opacity.value = withTiming(1, { duration: theme.animation.fast });
    }
  }, [status, opacity, theme.animation]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const dotStyle = useMemo<ViewStyle>(
    () => ({
      width: dotSize,
      height: dotSize,
      borderRadius: dotSize / 2,
      backgroundColor: color,
    }),
    [dotSize, color]
  );

  return <Animated.View style={[dotStyle, animatedStyle]} />;
}
