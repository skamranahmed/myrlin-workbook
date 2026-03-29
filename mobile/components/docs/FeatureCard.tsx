/**
 * FeatureCard.tsx - Card component for a single feature on the kanban board.
 *
 * Renders feature name, description (2-line clamp), priority chip,
 * and session count. Long press opens an ActionSheet with Edit,
 * Change Status, and Delete options.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View, type ViewStyle, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import { Chip, ActionSheet } from '@/components/ui';
import type { Feature } from '@/types/api';

/** Props for FeatureCard */
export interface FeatureCardProps {
  /** The feature data */
  feature: Feature;
  /** Called when Edit is selected from the action sheet */
  onEdit: (feature: Feature) => void;
  /** Called when Change Status is selected, with the new status */
  onChangeStatus: (feature: Feature, status: Feature['status']) => void;
  /** Called when Delete is selected */
  onDelete: (feature: Feature) => void;
}

/**
 * Maps priority to a Catppuccin color for the chip.
 * @param priority - Feature priority level
 * @param colors - Theme colors
 * @returns Hex color string
 */
function priorityColor(
  priority: string | undefined,
  colors: { green: string; yellow: string; red: string; textSecondary: string }
): string {
  switch (priority) {
    case 'high':
      return colors.red;
    case 'medium':
      return colors.yellow;
    case 'low':
      return colors.green;
    default:
      return colors.textSecondary;
  }
}

/**
 * FeatureCard - Renders a kanban card for a single feature.
 *
 * @param props - FeatureCard configuration
 */
export function FeatureCard({
  feature,
  onEdit,
  onChangeStatus,
  onDelete,
}: FeatureCardProps) {
  const { theme } = useTheme();
  const { colors, spacing, typography, radius, shadows } = theme;

  const [showActions, setShowActions] = useState(false);

  /** Build the list of status change options (excluding current status) */
  const statusOptions = useMemo(() => {
    const all: Feature['status'][] = ['backlog', 'active', 'done'];
    return all.filter((s) => s !== feature.status);
  }, [feature.status]);

  /** Long press handler to show action sheet */
  const handleLongPress = useCallback(() => {
    setShowActions(true);
  }, []);

  /** Build actions for the ActionSheet */
  const actions = useMemo(
    () => [
      {
        label: 'Edit',
        icon: <Ionicons name="pencil-outline" size={18} color={colors.textPrimary} />,
        onPress: () => onEdit(feature),
      },
      ...statusOptions.map((status) => ({
        label: `Move to ${status.charAt(0).toUpperCase() + status.slice(1)}`,
        icon: (
          <Ionicons name="swap-horizontal-outline" size={18} color={colors.textPrimary} />
        ),
        onPress: () => onChangeStatus(feature, status),
      })),
      {
        label: 'Delete',
        icon: <Ionicons name="trash-outline" size={18} color={colors.red} />,
        destructive: true,
        onPress: () => onDelete(feature),
      },
    ],
    [feature, statusOptions, onEdit, onChangeStatus, onDelete, colors]
  );

  const cardStyle = useMemo<ViewStyle>(
    () => ({
      backgroundColor: colors.surface0,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      padding: spacing.md,
      marginBottom: spacing.sm,
      ...shadows.sm,
    }),
    [colors, radius, spacing, shadows]
  );

  const nameStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textPrimary,
      fontFamily: fonts.sans.semibold,
      fontSize: typography.sizes.sm,
      marginBottom: 4,
    }),
    [colors, typography]
  );

  const descStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textSecondary,
      fontFamily: fonts.sans.regular,
      fontSize: typography.sizes.xs,
      marginBottom: spacing.sm,
    }),
    [colors, typography, spacing]
  );

  const metaRowStyle = useMemo<ViewStyle>(
    () => ({
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    }),
    [spacing]
  );

  const sessionCountStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: typography.sizes.xs,
    }),
    [colors, typography]
  );

  return (
    <>
      <Pressable
        onLongPress={handleLongPress}
        style={({ pressed }) => [cardStyle, { opacity: pressed ? 0.9 : 1 }]}
        delayLongPress={400}
      >
        <Text style={nameStyle} numberOfLines={1}>
          {feature.name}
        </Text>
        {feature.description ? (
          <Text style={descStyle} numberOfLines={2}>
            {feature.description}
          </Text>
        ) : null}

        <View style={metaRowStyle}>
          {feature.priority ? (
            <Chip
              label={feature.priority}
              selected
              color={priorityColor(feature.priority, colors)}
            />
          ) : null}
          {feature.sessionIds.length > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="git-branch-outline" size={14} color={colors.textMuted} />
              <Text style={sessionCountStyle}>
                {feature.sessionIds.length}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      <ActionSheet
        visible={showActions}
        onClose={() => setShowActions(false)}
        actions={actions}
      />
    </>
  );
}
