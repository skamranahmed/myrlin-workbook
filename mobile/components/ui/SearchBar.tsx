/**
 * SearchBar.tsx - Pill-shaped search input with icon and clear button.
 *
 * Renders a TextInput with a magnifying glass prefix icon and a
 * clear button when the input has content. Uses pill shape (radius.full).
 */

import React, { useMemo } from 'react';
import {
  Pressable,
  TextInput,
  View,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';

export interface SearchBarProps {
  /** Current search text */
  value: string;
  /** Called when search text changes */
  onChangeText: (text: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Called when the user submits the search */
  onSubmit?: () => void;
}

/**
 * SearchBar - Pill-shaped search input with icon prefix and clear button.
 *
 * @param props - SearchBar configuration
 */
export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search...',
  onSubmit,
}: SearchBarProps) {
  const { theme } = useTheme();
  const { colors, radius, spacing, typography } = theme;

  const containerStyle = useMemo<ViewStyle>(
    () => ({
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface0,
      borderRadius: radius.full,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      gap: spacing.xs,
    }),
    [colors, radius, spacing]
  );

  const inputStyle = useMemo<TextStyle>(
    () => ({
      flex: 1,
      color: colors.textPrimary,
      fontFamily: fonts.sans.regular,
      fontSize: typography.sizes.md,
      paddingVertical: 0,
    }),
    [colors, typography]
  );

  return (
    <View style={containerStyle}>
      <Ionicons name="search" size={18} color={colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        onSubmitEditing={onSubmit}
        returnKeyType="search"
        style={inputStyle}
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChangeText('')}>
          <Ionicons name="close-circle" size={18} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}
