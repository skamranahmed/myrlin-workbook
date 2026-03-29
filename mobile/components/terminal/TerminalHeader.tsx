/**
 * TerminalHeader.tsx - Native header bar for the terminal screen.
 *
 * Displays the session name, status dot, activity indicator, and back
 * button. The activity text shows what the Claude Code session is
 * currently doing (reading, writing, thinking) and fades between states.
 *
 * The overflow menu icon is a placeholder for Plan 02 (toolbar actions).
 */

import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { useTheme } from '../../hooks/useTheme';
import { StatusDot } from '../ui';
import { fonts } from '../../theme/fonts';
import type { StatusType } from '../ui';

/** Props for the TerminalHeader component */
export interface TerminalHeaderProps {
  /** Session display name (truncated if long) */
  sessionName: string;
  /** Session status for the StatusDot */
  status: StatusType;
  /** Current activity from the terminal bridge */
  activity?: { kind: string; detail: string };
  /** Navigate back to session detail */
  onBack: () => void;
}

/**
 * TerminalHeader - Horizontal bar with back button, session info, and activity.
 *
 * Layout: [back chevron] [session name] [status dot] [activity text] [spacer] [menu icon]
 *
 * Activity text animates in/out with FadeIn/FadeOut from Reanimated.
 * Only shown when kind is not 'idle' (idle means no detected activity).
 */
export function TerminalHeader({
  sessionName,
  status,
  activity,
  onBack,
}: TerminalHeaderProps) {
  const { theme } = useTheme();
  const { colors, spacing, radius } = theme;

  const showActivity = activity && activity.kind !== 'idle' && activity.detail;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.bgSecondary,
          borderBottomColor: colors.borderSubtle,
          paddingHorizontal: spacing.sm,
        },
      ]}
    >
      {/* Back button */}
      <Pressable onPress={onBack} style={styles.backButton} hitSlop={8}>
        <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
      </Pressable>

      {/* Session name */}
      <Text
        style={[
          styles.sessionName,
          { color: colors.textPrimary, fontFamily: fonts.sans.semibold },
        ]}
        numberOfLines={1}
      >
        {sessionName}
      </Text>

      {/* Status dot */}
      <StatusDot status={status} size="sm" />

      {/* Activity indicator */}
      {showActivity ? (
        <Animated.Text
          entering={FadeIn.duration(150)}
          exiting={FadeOut.duration(150)}
          style={[
            styles.activityText,
            { color: colors.textMuted, fontFamily: fonts.mono.regular },
          ]}
          numberOfLines={1}
        >
          {activity.detail}
        </Animated.Text>
      ) : null}

      {/* Spacer */}
      <View style={styles.spacer} />

      {/* Overflow menu placeholder (Plan 02) */}
      <Pressable style={styles.menuButton} hitSlop={8}>
        <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderBottomWidth: 1,
    gap: 8,
  },
  backButton: {
    padding: 8,
  },
  sessionName: {
    fontSize: 15,
    maxWidth: 160,
    flexShrink: 1,
  },
  activityText: {
    fontSize: 11,
    maxWidth: 120,
    flexShrink: 1,
  },
  spacer: {
    flex: 1,
  },
  menuButton: {
    padding: 8,
  },
});
