/**
 * WorkspaceItem.tsx - Memoized pressable card for workspace list display.
 *
 * Shows a color dot, workspace name, description, session count, and an
 * optional drag handle for reorder mode. Applies a subtle scale-up and
 * elevated shadow when being dragged via Reanimated.
 */

import React, { useMemo } from 'react';
import { Pressable, Text, View, type ViewStyle, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import type { Workspace } from '@/types/api';

/** Props for the WorkspaceItem component */
export interface WorkspaceItemProps {
  /** The workspace to display */
  workspace: Workspace;
  /** Number of sessions in this workspace */
  sessionCount: number;
  /** Called when the item is tapped */
  onPress: (id: string) => void;
  /** Called when the item is long-pressed (opens actions) */
  onLongPress: (id: string) => void;
  /** Whether this item is currently being dragged */
  isDragging?: boolean;
  /** Whether reorder mode is active (shows drag handle) */
  reorderMode?: boolean;
  /** Called to move this workspace up in the order */
  onMoveUp?: (id: string) => void;
  /** Called to move this workspace down in the order */
  onMoveDown?: (id: string) => void;
}

/**
 * WorkspaceItem - A single workspace row for the workspace list.
 *
 * Displays a color circle on the left, workspace name and description
 * in the center, session count, and a drag handle on the right when
 * reorder mode is enabled. Applies animated scale and elevation during drag.
 *
 * @param props - WorkspaceItem configuration
 */
function WorkspaceItemBase({
  workspace,
  sessionCount,
  onPress,
  onLongPress,
  isDragging = false,
  reorderMode = false,
  onMoveUp,
  onMoveDown,
}: WorkspaceItemProps) {
  const { theme } = useTheme();
  const { colors, radius, spacing, typography, shadows } = theme;

  /** Animated style for drag feedback (scale + shadow) */
  const dragStyle = useAnimatedStyle(() => {
    return {
      transform: [
        {
          scale: withTiming(isDragging ? 1.03 : 1, { duration: 150 }),
        },
      ],
    };
  }, [isDragging]);

  /** Color for the workspace indicator dot */
  const dotColor = workspace.color || colors.accent;

  /** Container style with card appearance */
  const containerStyle = useMemo<ViewStyle>(
    () => ({
      backgroundColor: colors.surface0,
      borderColor: colors.borderSubtle,
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      ...(isDragging ? shadows.md : {}),
    }),
    [colors, radius, spacing, shadows, isDragging]
  );

  /** Color dot indicator style */
  const dotStyle = useMemo<ViewStyle>(
    () => ({
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: dotColor,
    }),
    [dotColor]
  );

  /** Center column style */
  const centerStyle = useMemo<ViewStyle>(
    () => ({
      flex: 1,
      gap: 2,
    }),
    []
  );

  /** Workspace name text style */
  const nameStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textPrimary,
      fontFamily: fonts.sans.semibold,
      fontSize: typography.sizes.md,
    }),
    [colors, typography]
  );

  /** Description text style */
  const descStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textSecondary,
      fontFamily: fonts.sans.regular,
      fontSize: typography.sizes.sm,
    }),
    [colors, typography]
  );

  /** Session count badge text style */
  const countStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textTertiary,
      fontFamily: fonts.sans.medium,
      fontSize: typography.sizes.xs,
    }),
    [colors, typography]
  );

  /** Reorder button container style */
  const reorderButtonsStyle = useMemo<ViewStyle>(
    () => ({
      flexDirection: 'column',
      gap: 2,
    }),
    []
  );

  return (
    <Animated.View style={dragStyle}>
      <Pressable
        onPress={() => onPress(workspace.id)}
        onLongPress={() => onLongPress(workspace.id)}
        style={({ pressed }) => [
          containerStyle,
          { opacity: pressed ? 0.85 : 1 },
        ]}
      >
        {/* Color indicator dot */}
        <View style={dotStyle} />

        {/* Center: name, description, session count */}
        <View style={centerStyle}>
          <Text style={nameStyle} numberOfLines={1}>
            {workspace.name}
          </Text>
          {workspace.description ? (
            <Text style={descStyle} numberOfLines={1}>
              {workspace.description}
            </Text>
          ) : null}
          <Text style={countStyle}>
            {sessionCount} {sessionCount === 1 ? 'session' : 'sessions'}
          </Text>
        </View>

        {/* Right: reorder controls or chevron */}
        {reorderMode ? (
          <View style={reorderButtonsStyle}>
            <Pressable
              onPress={() => onMoveUp?.(workspace.id)}
              hitSlop={8}
            >
              <Ionicons
                name="chevron-up"
                size={18}
                color={colors.textSecondary}
              />
            </Pressable>
            <Pressable
              onPress={() => onMoveDown?.(workspace.id)}
              hitSlop={8}
            >
              <Ionicons
                name="chevron-down"
                size={18}
                color={colors.textSecondary}
              />
            </Pressable>
          </View>
        ) : (
          <Ionicons
            name="reorder-three"
            size={20}
            color={colors.textMuted}
          />
        )}
      </Pressable>
    </Animated.View>
  );
}

/** Memoized workspace item to avoid unnecessary re-renders in lists */
export const WorkspaceItem = React.memo(WorkspaceItemBase);
