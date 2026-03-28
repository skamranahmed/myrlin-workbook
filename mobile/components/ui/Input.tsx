/**
 * Input.tsx - Themed text input with label and error state.
 *
 * Renders a TextInput with surface background, themed border, and
 * optional label above and error message below. Error state changes
 * the border to red.
 */

import React, { useMemo } from 'react';
import {
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
  type TextStyle,
} from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  /** Label displayed above the input */
  label?: string;
  /** Error message displayed below the input */
  error?: string;
  /** Additional container style */
  style?: ViewStyle;
}

/**
 * Input - Themed text input component with label and validation error.
 *
 * @param props - Input configuration
 */
export function Input({
  label,
  error,
  style,
  ...textInputProps
}: InputProps) {
  const { theme } = useTheme();
  const { colors, radius, spacing, typography } = theme;

  const hasError = Boolean(error);

  const containerStyle = useMemo<ViewStyle>(
    () => ({
      gap: spacing.xs,
    }),
    [spacing]
  );

  const labelStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textSecondary,
      fontFamily: fonts.sans.medium,
      fontSize: typography.sizes.sm,
    }),
    [colors, typography]
  );

  const inputStyle = useMemo<TextStyle>(
    () => ({
      backgroundColor: colors.surface0,
      borderColor: hasError ? colors.red : colors.borderDefault,
      borderWidth: 1,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      color: colors.textPrimary,
      fontFamily: fonts.sans.regular,
      fontSize: typography.sizes.md,
    }),
    [colors, radius, spacing, typography, hasError]
  );

  const errorStyle = useMemo<TextStyle>(
    () => ({
      color: colors.red,
      fontFamily: fonts.sans.regular,
      fontSize: typography.sizes.xs,
    }),
    [colors, typography]
  );

  return (
    <View style={[containerStyle, style]}>
      {label ? <Text style={labelStyle}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.textMuted}
        {...textInputProps}
        style={inputStyle}
      />
      {error ? <Text style={errorStyle}>{error}</Text> : null}
    </View>
  );
}
