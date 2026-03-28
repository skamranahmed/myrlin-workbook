/**
 * EmptyState.tsx - Centered empty state with icon, title, description, and action.
 *
 * Displayed when a list or screen has no data. Provides contextual
 * messaging and an optional call-to-action button.
 */

import React, { useMemo } from 'react';
import { Text, View, type ViewStyle, type TextStyle } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import { Button } from './Button';

export interface EmptyStateProps {
  /** Icon element rendered above the title */
  icon?: React.ReactNode;
  /** Primary heading text */
  title: string;
  /** Secondary description text */
  description: string;
  /** Optional action button */
  action?: {
    label: string;
    onPress: () => void;
  };
}

/**
 * EmptyState - Centered placeholder for empty screens and lists.
 *
 * @param props - EmptyState configuration
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  const { theme } = useTheme();
  const { colors, spacing, typography } = theme;

  const containerStyle = useMemo<ViewStyle>(
    () => ({
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
      gap: spacing.sm,
    }),
    [spacing]
  );

  const titleStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textPrimary,
      fontFamily: fonts.sans.semibold,
      fontSize: typography.sizes.lg,
      textAlign: 'center',
    }),
    [colors, typography]
  );

  const descStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textSecondary,
      fontFamily: fonts.sans.regular,
      fontSize: typography.sizes.md,
      textAlign: 'center',
      lineHeight: typography.sizes.md * 1.5,
    }),
    [colors, typography]
  );

  return (
    <View style={containerStyle}>
      {icon ? <View style={{ marginBottom: spacing.sm }}>{icon}</View> : null}
      <Text style={titleStyle}>{title}</Text>
      <Text style={descStyle}>{description}</Text>
      {action ? (
        <View style={{ marginTop: spacing.md }}>
          <Button variant="ghost" onPress={action.onPress}>
            {action.label}
          </Button>
        </View>
      ) : null}
    </View>
  );
}
