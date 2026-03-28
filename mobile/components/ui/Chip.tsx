/**
 * Chip.tsx - Small selectable pill for filters and tags.
 *
 * Used for workspace filters, tag filters, and status selectors.
 * Selected state uses accent bg with crust text; unselected uses
 * surface0 bg with textSecondary.
 */

import React, { useMemo } from 'react';
import { Pressable, Text, type ViewStyle, type TextStyle } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';

export interface ChipProps {
  /** Chip label text */
  label: string;
  /** Whether the chip is in selected state */
  selected?: boolean;
  /** Called when the chip is pressed */
  onPress?: () => void;
  /** Optional custom accent color (defaults to theme accent) */
  color?: string;
}

/**
 * Chip - Small pill for filter and tag selection.
 *
 * @param props - Chip configuration
 */
export function Chip({ label, selected = false, onPress, color }: ChipProps) {
  const { theme } = useTheme();
  const { colors, radius, spacing, typography } = theme;

  const accentColor = color ?? colors.accent;

  const containerStyle = useMemo<ViewStyle>(
    () => ({
      backgroundColor: selected ? accentColor : colors.surface0,
      borderRadius: radius.full,
      paddingHorizontal: spacing.sm + 4,
      paddingVertical: spacing.xs,
      alignSelf: 'flex-start' as const,
    }),
    [selected, accentColor, colors, radius, spacing]
  );

  const textStyle = useMemo<TextStyle>(
    () => ({
      color: selected ? colors.crust : colors.textSecondary,
      fontFamily: fonts.sans.medium,
      fontSize: typography.sizes.sm,
    }),
    [selected, colors, typography]
  );

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [containerStyle, { opacity: pressed ? 0.85 : 1 }]}
    >
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}
