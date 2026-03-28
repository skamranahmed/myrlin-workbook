/**
 * Toast.tsx - Animated notification toast that slides in from the top.
 *
 * Supports success, error, info, and warning variants with a colored
 * left border. Auto-dismisses after 3 seconds. Uses Reanimated for
 * smooth slide-in/out transitions.
 */

import React, { useEffect, useMemo } from 'react';
import { Pressable, Text, type ViewStyle, type TextStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import type { MyrlinTheme } from '@/theme/types';

/** Toast color variants */
export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

export interface ToastProps {
  /** Toast message text */
  message: string;
  /** Color variant */
  variant?: ToastVariant;
  /** Whether the toast is visible */
  visible: boolean;
  /** Called when the toast should dismiss */
  onDismiss: () => void;
}

/** Auto-dismiss delay in milliseconds */
const AUTO_DISMISS_MS = 3000;

/**
 * Resolves the left border accent color for the toast variant.
 *
 * @param variant - Toast variant
 * @param colors - Theme color tokens
 * @returns Accent color string
 */
function getAccentColor(
  variant: ToastVariant,
  colors: MyrlinTheme['colors']
): string {
  switch (variant) {
    case 'success':
      return colors.green;
    case 'error':
      return colors.red;
    case 'warning':
      return colors.yellow;
    case 'info':
      return colors.blue;
  }
}

/**
 * Toast - Slide-in notification with auto-dismiss.
 *
 * @param props - Toast configuration
 */
export function Toast({
  message,
  variant = 'info',
  visible,
  onDismiss,
}: ToastProps) {
  const { theme } = useTheme();
  const { colors, radius, spacing, typography, animation } = theme;
  const accentColor = getAccentColor(variant, colors);

  const translateY = useSharedValue(-100);

  useEffect(() => {
    if (visible) {
      translateY.value = withTiming(0, {
        duration: animation.normal,
        easing: Easing.out(Easing.ease),
      });

      const timer = setTimeout(() => {
        translateY.value = withTiming(
          -100,
          { duration: animation.normal, easing: Easing.in(Easing.ease) },
          (finished) => {
            if (finished) {
              runOnJS(onDismiss)();
            }
          }
        );
      }, AUTO_DISMISS_MS);

      return () => clearTimeout(timer);
    } else {
      translateY.value = -100;
    }
  }, [visible, translateY, animation, onDismiss]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const containerStyle = useMemo<ViewStyle>(
    () => ({
      position: 'absolute',
      top: spacing.xxl + spacing.md,
      left: spacing.md,
      right: spacing.md,
      backgroundColor: colors.surface0,
      borderRadius: radius.md,
      borderLeftWidth: 3,
      borderLeftColor: accentColor,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      zIndex: 9999,
      ...theme.shadows.md,
    }),
    [colors, radius, spacing, accentColor, theme.shadows.md]
  );

  const textStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textPrimary,
      fontFamily: fonts.sans.medium,
      fontSize: typography.sizes.sm,
    }),
    [colors, typography]
  );

  if (!visible) return null;

  return (
    <Animated.View style={[containerStyle, animatedStyle]}>
      <Pressable onPress={onDismiss}>
        <Text style={textStyle}>{message}</Text>
      </Pressable>
    </Animated.View>
  );
}
