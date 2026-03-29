/**
 * SegmentedControl.tsx - Horizontal segmented selector.
 *
 * Renders a row of text segments where one is active (accent bg).
 * Used for tab-like filtering (e.g. session status filter, time range).
 */

import React, { useMemo } from 'react';
import {
  Pressable,
  Text,
  View,
  type ViewStyle,
  type TextStyle,
} from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import { hapticSelection } from '@/utils/haptics';

export interface SegmentedControlProps {
  /** Segment labels */
  segments: string[];
  /** Currently selected index */
  selectedIndex: number;
  /** Called when a segment is selected */
  onSelect: (index: number) => void;
}

/**
 * SegmentedControl - Horizontal row of selectable segments.
 *
 * @param props - SegmentedControl configuration
 */
export function SegmentedControl({
  segments,
  selectedIndex,
  onSelect,
}: SegmentedControlProps) {
  const { theme } = useTheme();
  const { colors, radius, spacing, typography } = theme;

  const containerStyle = useMemo<ViewStyle>(
    () => ({
      flexDirection: 'row',
      backgroundColor: colors.surface0,
      borderRadius: radius.md,
      padding: 2,
    }),
    [colors, radius]
  );

  return (
    <View style={containerStyle}>
      {segments.map((label, index) => {
        const isActive = index === selectedIndex;

        const segmentStyle: ViewStyle = {
          flex: 1,
          paddingVertical: spacing.xs + 2,
          paddingHorizontal: spacing.sm,
          borderRadius: radius.md - 2,
          alignItems: 'center',
          backgroundColor: isActive ? colors.accent : 'transparent',
        };

        const textStyle: TextStyle = {
          color: isActive ? colors.crust : colors.textSecondary,
          fontFamily: fonts.sans.medium,
          fontSize: typography.sizes.sm,
        };

        return (
          <Pressable
            key={label}
            onPress={() => {
              hapticSelection();
              onSelect(index);
            }}
            style={segmentStyle}
          >
            <Text style={textStyle}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
