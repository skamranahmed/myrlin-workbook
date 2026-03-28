/**
 * Toggle.tsx - Themed switch with label and optional description.
 *
 * Wraps React Native Switch with Catppuccin accent colors and
 * provides label + description text alongside the toggle.
 */

import React, { useMemo } from 'react';
import { Switch, Text, View, type ViewStyle, type TextStyle } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';

export interface ToggleProps {
  /** Current toggle state */
  value: boolean;
  /** Called when toggle state changes */
  onValueChange: (value: boolean) => void;
  /** Primary label text */
  label: string;
  /** Secondary description text below the label */
  description?: string;
}

/**
 * Toggle - Themed switch with label and optional description.
 *
 * @param props - Toggle configuration
 */
export function Toggle({ value, onValueChange, label, description }: ToggleProps) {
  const { theme } = useTheme();
  const { colors, spacing, typography } = theme;

  const rowStyle = useMemo<ViewStyle>(
    () => ({
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    }),
    [spacing]
  );

  const textContainerStyle = useMemo<ViewStyle>(
    () => ({
      flex: 1,
      gap: 2,
    }),
    []
  );

  const labelStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textPrimary,
      fontFamily: fonts.sans.medium,
      fontSize: typography.sizes.md,
    }),
    [colors, typography]
  );

  const descStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textSecondary,
      fontFamily: fonts.sans.regular,
      fontSize: typography.sizes.sm,
    }),
    [colors, typography]
  );

  return (
    <View style={rowStyle}>
      <View style={textContainerStyle}>
        <Text style={labelStyle}>{label}</Text>
        {description ? <Text style={descStyle}>{description}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{
          false: colors.surface1,
          true: colors.accent,
        }}
        thumbColor={colors.text}
      />
    </View>
  );
}
