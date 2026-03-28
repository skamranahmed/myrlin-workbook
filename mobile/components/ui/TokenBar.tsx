/**
 * TokenBar.tsx - Horizontal stacked bar showing token type proportions.
 *
 * Renders a fixed-height bar segmented by token categories: input (blue),
 * output (green), cacheRead (teal), and cacheWrite (peach). Used on
 * session cards and the cost dashboard.
 */

import React, { useMemo } from 'react';
import { View, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/useTheme';

export interface TokenBarProps {
  /** Input token proportion (0-1) */
  input: number;
  /** Output token proportion (0-1) */
  output: number;
  /** Cache read token proportion (0-1) */
  cacheRead: number;
  /** Cache write token proportion (0-1) */
  cacheWrite: number;
}

/** Fixed bar height in pixels */
const BAR_HEIGHT = 6;

/**
 * TokenBar - Proportional stacked bar for token usage visualization.
 *
 * @param props - Token proportions (should sum to approximately 1)
 */
export function TokenBar({ input, output, cacheRead, cacheWrite }: TokenBarProps) {
  const { theme } = useTheme();
  const { colors, radius } = theme;

  const containerStyle = useMemo<ViewStyle>(
    () => ({
      flexDirection: 'row',
      height: BAR_HEIGHT,
      borderRadius: radius.sm,
      overflow: 'hidden',
      backgroundColor: colors.surface0,
    }),
    [colors, radius]
  );

  const segments = useMemo(
    () => [
      { flex: input, color: colors.blue },
      { flex: output, color: colors.green },
      { flex: cacheRead, color: colors.teal },
      { flex: cacheWrite, color: colors.peach },
    ],
    [input, output, cacheRead, cacheWrite, colors]
  );

  return (
    <View style={containerStyle}>
      {segments.map((seg, idx) =>
        seg.flex > 0 ? (
          <View
            key={idx}
            style={{ flex: seg.flex, backgroundColor: seg.color }}
          />
        ) : null
      )}
    </View>
  );
}
