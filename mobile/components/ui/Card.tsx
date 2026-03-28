/**
 * Card.tsx - Themed card container with optional press interaction.
 *
 * Renders a surface-colored container with subtle border and optional
 * shadow elevation. Becomes a Pressable when onPress is provided.
 */

import React, { useMemo } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/useTheme';

export interface CardProps {
  /** Card content */
  children: React.ReactNode;
  /** Optional press handler (makes card tappable) */
  onPress?: () => void;
  /** Whether to apply elevated shadow */
  elevated?: boolean;
  /** Additional style overrides */
  style?: ViewStyle;
}

/**
 * Card - Themed container with border, radius, and optional elevation.
 *
 * @param props - Card configuration
 */
export function Card({ children, onPress, elevated = false, style }: CardProps) {
  const { theme } = useTheme();
  const { colors, radius, spacing, shadows } = theme;

  const containerStyle = useMemo<ViewStyle>(
    () => ({
      backgroundColor: colors.surface0,
      borderColor: colors.borderSubtle,
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: spacing.md,
      ...(elevated ? shadows.md : {}),
    }),
    [colors, radius, spacing, shadows, elevated]
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          containerStyle,
          style,
          { opacity: pressed ? 0.85 : 1 },
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={[containerStyle, style]}>{children}</View>;
}
