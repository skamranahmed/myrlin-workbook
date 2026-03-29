/**
 * ActionSheet.tsx - iOS-style action sheet rendered as a bottom modal.
 *
 * Displays a list of action items with optional destructive styling.
 * Includes a cancel button at the bottom separated by a gap.
 * Uses ModalSheet internally for the slide-up animation.
 */

import React, { useMemo } from 'react';
import { Pressable, Text, View, type ViewStyle, type TextStyle } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import { hapticImpact } from '@/utils/haptics';

/** Single action item in the sheet */
export interface ActionSheetAction {
  /** Action label text */
  label: string;
  /** Optional icon element */
  icon?: React.ReactNode;
  /** Whether this action is destructive (renders in red) */
  destructive?: boolean;
  /** Called when the action is selected */
  onPress: () => void;
}

export interface ActionSheetProps {
  /** Whether the action sheet is visible */
  visible: boolean;
  /** Called when the sheet should close */
  onClose: () => void;
  /** List of available actions */
  actions: ActionSheetAction[];
}

/**
 * ActionSheet - Bottom sheet with a list of actions and cancel button.
 *
 * @param props - ActionSheet configuration
 */
export function ActionSheet({ visible, onClose, actions }: ActionSheetProps) {
  const { theme } = useTheme();
  const { colors, radius, spacing, typography } = theme;

  const overlayStyle = useMemo<ViewStyle>(
    () => ({
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
      paddingHorizontal: spacing.sm,
      paddingBottom: spacing.xl,
    }),
    [spacing]
  );

  const groupStyle = useMemo<ViewStyle>(
    () => ({
      backgroundColor: colors.surface0,
      borderRadius: radius.lg,
      overflow: 'hidden',
    }),
    [colors, radius]
  );

  const cancelStyle = useMemo<ViewStyle>(
    () => ({
      backgroundColor: colors.surface0,
      borderRadius: radius.lg,
      marginTop: spacing.sm,
      paddingVertical: spacing.md,
      alignItems: 'center',
    }),
    [colors, radius, spacing]
  );

  const cancelTextStyle = useMemo<TextStyle>(
    () => ({
      color: colors.accent,
      fontFamily: fonts.sans.semibold,
      fontSize: typography.sizes.md,
    }),
    [colors, typography]
  );

  if (!visible) return null;

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9998,
      }}
    >
      <Pressable style={overlayStyle} onPress={onClose}>
        <Pressable>
          <View style={groupStyle}>
            {actions.map((action, idx) => {
              const isLast = idx === actions.length - 1;

              const itemStyle: ViewStyle = {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: spacing.sm,
                paddingVertical: spacing.md,
                borderBottomWidth: isLast ? 0 : 1,
                borderBottomColor: colors.borderSubtle,
              };

              const labelStyle: TextStyle = {
                color: action.destructive ? colors.red : colors.textPrimary,
                fontFamily: fonts.sans.medium,
                fontSize: typography.sizes.md,
              };

              return (
                <Pressable
                  key={action.label}
                  onPress={() => {
                    hapticImpact('light');
                    action.onPress();
                    onClose();
                  }}
                  style={({ pressed }) => [
                    itemStyle,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  {action.icon}
                  <Text style={labelStyle}>{action.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              cancelStyle,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={cancelTextStyle}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </View>
  );
}
