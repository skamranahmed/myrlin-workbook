/**
 * Skeleton.tsx - Animated shimmer placeholder for loading states.
 *
 * Uses Reanimated to oscillate opacity between 0.3 and 0.7,
 * creating a pulse effect. Preferred over spinners per the
 * Myrlin design system.
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

export interface SkeletonProps {
  /** Width of the skeleton rectangle */
  width: number | string;
  /** Height of the skeleton rectangle */
  height: number;
  /** Corner radius (defaults to theme.radius.md) */
  borderRadius?: number;
}

/**
 * Skeleton - Animated loading placeholder.
 *
 * Renders a surface-colored rectangle that pulses between 30% and 70%
 * opacity using Reanimated. Use instead of spinners.
 *
 * @param props - Skeleton dimensions and border radius
 */
export function Skeleton({ width, height, borderRadius }: SkeletonProps) {
  const { theme } = useTheme();
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.7, {
        duration: theme.animation.slow * 3,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true
    );
  }, [opacity, theme.animation.slow]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const baseStyle = useMemo<ViewStyle>(
    () => ({
      width: width as number,
      height,
      borderRadius: borderRadius ?? theme.radius.md,
      backgroundColor: theme.colors.surface1,
    }),
    [width, height, borderRadius, theme.radius.md, theme.colors.surface1]
  );

  return <Animated.View style={[baseStyle, animatedStyle]} />;
}
