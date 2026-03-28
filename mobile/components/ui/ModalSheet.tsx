/**
 * ModalSheet.tsx - Bottom sheet modal with handle bar and backdrop.
 *
 * Slides up from the bottom using Reanimated. Tapping the backdrop
 * overlay closes the sheet. Includes a handle bar at the top and
 * optional title text.
 */

import React, { useEffect, useMemo } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  Text,
  View,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';

export interface ModalSheetProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** Called when the modal should close */
  onClose: () => void;
  /** Optional title displayed below the handle bar */
  title?: string;
  /** Modal content */
  children: React.ReactNode;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * ModalSheet - Animated bottom sheet with backdrop overlay.
 *
 * @param props - ModalSheet configuration
 */
export function ModalSheet({
  visible,
  onClose,
  title,
  children,
}: ModalSheetProps) {
  const { theme } = useTheme();
  const { colors, radius, spacing, typography, animation } = theme;

  const translateY = useSharedValue(SCREEN_HEIGHT);

  useEffect(() => {
    if (visible) {
      translateY.value = withTiming(0, {
        duration: animation.normal,
        easing: Easing.out(Easing.ease),
      });
    } else {
      translateY.value = withTiming(SCREEN_HEIGHT, {
        duration: animation.fast,
        easing: Easing.in(Easing.ease),
      });
    }
  }, [visible, translateY, animation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useMemo<ViewStyle>(
    () => ({
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    }),
    []
  );

  const sheetStyle = useMemo<ViewStyle>(
    () => ({
      backgroundColor: colors.mantle,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingBottom: spacing.xxl,
      maxHeight: SCREEN_HEIGHT * 0.85,
    }),
    [colors, radius, spacing]
  );

  const handleStyle = useMemo<ViewStyle>(
    () => ({
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.surface2,
      alignSelf: 'center',
      marginTop: spacing.sm,
      marginBottom: spacing.md,
    }),
    [colors, spacing]
  );

  const titleStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textPrimary,
      fontFamily: fonts.sans.semibold,
      fontSize: typography.sizes.lg,
      textAlign: 'center',
      marginBottom: spacing.md,
    }),
    [colors, typography, spacing]
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <Pressable style={backdropStyle} onPress={onClose}>
        <Animated.View style={[sheetStyle, animatedStyle]}>
          <Pressable>
            <View style={handleStyle} />
            {title ? <Text style={titleStyle}>{title}</Text> : null}
            <View style={{ paddingHorizontal: spacing.md }}>{children}</View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
