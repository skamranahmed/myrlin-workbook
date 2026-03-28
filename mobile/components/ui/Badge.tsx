/**
 * Badge.tsx - Small themed pill for status labels and counts.
 *
 * Supports default, success, warning, error, and info variants
 * with colored backgrounds and contrasting text.
 */

import React, { useMemo } from 'react';
import { Text, View, type ViewStyle, type TextStyle } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import type { MyrlinTheme } from '@/theme/types';

/** Badge color variants */
export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

export interface BadgeProps {
  /** Visual variant */
  variant?: BadgeVariant;
  /** Label text */
  children: string;
}

/**
 * Resolves badge background and text colors for the given variant.
 *
 * @param variant - Badge variant
 * @param colors - Theme color tokens
 * @returns Tuple of [backgroundColor, textColor]
 */
function getBadgeColors(
  variant: BadgeVariant,
  colors: MyrlinTheme['colors']
): [string, string] {
  switch (variant) {
    case 'success':
      return [colors.green + '22', colors.green];
    case 'warning':
      return [colors.yellow + '22', colors.yellow];
    case 'error':
      return [colors.red + '22', colors.red];
    case 'info':
      return [colors.blue + '22', colors.blue];
    case 'default':
    default:
      return [colors.surface1, colors.textSecondary];
  }
}

/**
 * Badge - Small pill component for status labels and counters.
 *
 * @param props - Badge configuration
 */
export function Badge({ variant = 'default', children }: BadgeProps) {
  const { theme } = useTheme();
  const [bgColor, textColor] = getBadgeColors(variant, theme.colors);

  const containerStyle = useMemo<ViewStyle>(
    () => ({
      backgroundColor: bgColor,
      borderRadius: theme.radius.full,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 2,
      alignSelf: 'flex-start' as const,
    }),
    [bgColor, theme.radius.full, theme.spacing.sm]
  );

  const labelStyle = useMemo<TextStyle>(
    () => ({
      color: textColor,
      fontFamily: fonts.sans.medium,
      fontSize: theme.typography.sizes.xs,
    }),
    [textColor, theme.typography.sizes.xs]
  );

  return (
    <View style={containerStyle}>
      <Text style={labelStyle}>{children}</Text>
    </View>
  );
}
