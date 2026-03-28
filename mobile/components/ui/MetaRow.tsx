/**
 * MetaRow.tsx - Horizontal metadata row with label and value.
 *
 * Displays a key-value pair in a horizontal layout with an optional
 * icon. Used in session detail, task detail, and settings screens.
 */

import React, { useMemo } from 'react';
import { Text, View, type ViewStyle, type TextStyle } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';

export interface MetaRowProps {
  /** Left-side label text */
  label: string;
  /** Right-side value text */
  value: string;
  /** Optional icon element rendered before the label */
  icon?: React.ReactNode;
}

/**
 * MetaRow - Horizontal key-value metadata display.
 *
 * @param props - MetaRow configuration
 */
export function MetaRow({ label, value, icon }: MetaRowProps) {
  const { theme } = useTheme();
  const { colors, spacing, typography } = theme;

  const containerStyle = useMemo<ViewStyle>(
    () => ({
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.xs + 2,
    }),
    [spacing]
  );

  const leftStyle = useMemo<ViewStyle>(
    () => ({
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    }),
    [spacing]
  );

  const labelStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textSecondary,
      fontFamily: fonts.sans.regular,
      fontSize: typography.sizes.sm,
    }),
    [colors, typography]
  );

  const valueStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textPrimary,
      fontFamily: fonts.sans.medium,
      fontSize: typography.sizes.sm,
    }),
    [colors, typography]
  );

  return (
    <View style={containerStyle}>
      <View style={leftStyle}>
        {icon}
        <Text style={labelStyle}>{label}</Text>
      </View>
      <Text style={valueStyle}>{value}</Text>
    </View>
  );
}
