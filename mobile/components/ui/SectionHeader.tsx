/**
 * SectionHeader.tsx - Uppercase section title with optional action link.
 *
 * Used to separate groups of content in lists and detail screens.
 * Title renders in textSecondary, uppercase, with an optional
 * right-aligned action button.
 */

import React, { useMemo } from 'react';
import { Pressable, Text, View, type ViewStyle, type TextStyle } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';

export interface SectionHeaderProps {
  /** Section title (rendered uppercase) */
  title: string;
  /** Optional right-aligned action */
  action?: {
    label: string;
    onPress: () => void;
  };
}

/**
 * SectionHeader - Section divider with title and optional action.
 *
 * @param props - SectionHeader configuration
 */
export function SectionHeader({ title, action }: SectionHeaderProps) {
  const { theme } = useTheme();
  const { colors, spacing, typography } = theme;

  const containerStyle = useMemo<ViewStyle>(
    () => ({
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    }),
    [spacing]
  );

  const titleStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textSecondary,
      fontFamily: fonts.sans.semibold,
      fontSize: typography.sizes.xs,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    }),
    [colors, typography]
  );

  const actionStyle = useMemo<TextStyle>(
    () => ({
      color: colors.accent,
      fontFamily: fonts.sans.medium,
      fontSize: typography.sizes.xs,
    }),
    [colors, typography]
  );

  return (
    <View style={containerStyle}>
      <Text style={titleStyle}>{title}</Text>
      {action ? (
        <Pressable onPress={action.onPress}>
          <Text style={actionStyle}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
