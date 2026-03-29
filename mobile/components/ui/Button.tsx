/**
 * Button.tsx - Themed pressable button with variant and size support.
 *
 * Supports primary (accent bg), ghost (transparent bg), and danger (red bg)
 * variants. Loading state shows an ActivityIndicator. Uses Pressable with
 * pressed opacity feedback and disabled opacity reduction.
 */

import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type ViewStyle,
  type TextStyle,
} from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import { hapticImpact } from '@/utils/haptics';
import type { MyrlinTheme } from '@/theme/types';

/** Button visual variants */
export type ButtonVariant = 'primary' | 'ghost' | 'danger';

/** Button size options */
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps {
  /** Visual variant of the button */
  variant?: ButtonVariant;
  /** Size preset */
  size?: ButtonSize;
  /** Show loading spinner instead of children */
  loading?: boolean;
  /** Disable interaction and reduce opacity */
  disabled?: boolean;
  /** Optional icon element rendered before the label */
  icon?: React.ReactNode;
  /** Button label text or child elements */
  children: React.ReactNode;
  /** Press handler */
  onPress?: () => void;
}

/**
 * Resolves background color for the given variant and theme.
 *
 * @param variant - Button variant
 * @param colors - Theme color tokens
 * @returns Background color string
 */
function getBackgroundColor(
  variant: ButtonVariant,
  colors: MyrlinTheme['colors']
): string {
  switch (variant) {
    case 'primary':
      return colors.accent;
    case 'danger':
      return colors.red;
    case 'ghost':
      return 'transparent';
  }
}

/**
 * Resolves text color for the given variant and theme.
 *
 * @param variant - Button variant
 * @param colors - Theme color tokens
 * @returns Text color string
 */
function getTextColor(
  variant: ButtonVariant,
  colors: MyrlinTheme['colors']
): string {
  switch (variant) {
    case 'primary':
      return colors.crust;
    case 'danger':
      return colors.crust;
    case 'ghost':
      return colors.text;
  }
}

/**
 * Button - Themed pressable button component.
 *
 * @param props - Button configuration
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  children,
  onPress,
}: ButtonProps) {
  const { theme } = useTheme();
  const { colors, radius, spacing } = theme;

  const containerStyle = useMemo<ViewStyle>(
    () => ({
      backgroundColor: getBackgroundColor(variant, colors),
      borderRadius: radius.md,
      paddingHorizontal: size === 'sm' ? spacing.md : spacing.lg,
      paddingVertical: size === 'sm' ? spacing.xs + 2 : spacing.sm + 2,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      borderWidth: variant === 'ghost' ? 1 : 0,
      borderColor: variant === 'ghost' ? colors.borderDefault : 'transparent',
    }),
    [variant, size, colors, radius, spacing]
  );

  const textStyle = useMemo<TextStyle>(
    () => ({
      color: getTextColor(variant, colors),
      fontFamily: fonts.sans.semibold,
      fontSize: size === 'sm' ? theme.typography.sizes.sm : theme.typography.sizes.md,
    }),
    [variant, size, colors, theme.typography.sizes]
  );

  const spinnerColor = getTextColor(variant, colors);

  return (
    <Pressable
      onPress={() => {
        hapticImpact(variant === 'danger' ? 'medium' : 'light');
        onPress?.();
      }}
      disabled={disabled || loading}
      style={({ pressed }) => [
        containerStyle,
        { opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={spinnerColor} />
      ) : (
        <>
          {icon}
          {typeof children === 'string' ? (
            <Text style={textStyle}>{children}</Text>
          ) : (
            children
          )}
        </>
      )}
    </Pressable>
  );
}
