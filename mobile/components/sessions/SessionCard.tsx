/**
 * SessionCard.tsx - Memoized session list item for FlashList rendering.
 *
 * Displays a session's status, name, topic, activity state, and optional
 * workspace badge in a themed pressable card. Optimized for FlashList
 * cell recycling with React.memo and stable callbacks.
 *
 * Layout:
 *   Row 1: StatusDot + session name (bold, truncated) + workspace chip
 *   Row 2: Topic text (secondary, single line) or "No topic" muted
 *   Row 3: ActivityIndicator + tags as Badges + needs-input Badge
 */

import React, { memo, useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import { StatusDot, Badge, Chip } from '@/components/ui';
import { ActivityIndicator } from './ActivityIndicator';
import type { Session } from '@/types/api';

export interface SessionCardProps {
  /** Session data to display */
  session: Session;
  /** Called when the card is tapped */
  onPress: (id: string) => void;
  /** Called when the card is long-pressed */
  onLongPress: (id: string) => void;
  /** Whether to display the workspace badge */
  showWorkspace?: boolean;
  /** Workspace name for the badge (required when showWorkspace is true) */
  workspaceName?: string;
  /** Workspace color for the badge */
  workspaceColor?: string;
}

/**
 * Format an ISO timestamp as a relative "time ago" string.
 * Keeps it simple: minutes, hours, or date.
 * @param isoDate - ISO 8601 timestamp string
 * @returns Human-readable relative time
 */
function formatTimeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

/**
 * Get the last log message from a session's logs array.
 * @param session - Session with logs
 * @returns Last log message or undefined
 */
function getLastLog(session: Session): string | undefined {
  if (session.logs && session.logs.length > 0) {
    return session.logs[session.logs.length - 1].message;
  }
  return undefined;
}

/**
 * SessionCard - Memoized pressable card for the session list.
 *
 * Optimized for FlashList with React.memo. Uses useCallback for press
 * handlers and avoids inline object creation in styles to minimize
 * re-renders during SSE-driven list updates.
 *
 * @param props - Session data and interaction handlers
 */
const SessionCard = memo<SessionCardProps>(function SessionCard({
  session,
  onPress,
  onLongPress,
  showWorkspace = false,
  workspaceName,
  workspaceColor,
}) {
  const { theme } = useTheme();
  const { colors, spacing, radius, typography } = theme;

  const handlePress = useCallback(() => onPress(session.id), [session.id, onPress]);
  const handleLongPress = useCallback(() => onLongPress(session.id), [session.id, onLongPress]);

  // Determine if session needs input (idle status is the proxy)
  const needsInput = session.status === 'idle';

  // Get last log for activity indicator context
  const lastLog = getLastLog(session);

  // Card container style with theme colors
  const cardStyle = useMemo<ViewStyle>(
    () => ({
      backgroundColor: colors.surface0,
      borderColor: colors.borderSubtle,
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: spacing.md,
      marginBottom: spacing.sm,
      marginHorizontal: spacing.md,
    }),
    [colors, radius, spacing]
  );

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={handleLongPress}
      style={({ pressed }) => [cardStyle, { opacity: pressed ? 0.85 : 1 }]}
    >
      {/* Row 1: Status dot + name + workspace chip */}
      <View style={styles.topRow}>
        <StatusDot status={session.status} size="md" />
        <Text
          style={[
            styles.name,
            { color: colors.textPrimary, fontFamily: fonts.sans.semibold },
          ]}
          numberOfLines={1}
        >
          {session.name}
        </Text>
        <View style={styles.spacer} />
        {showWorkspace && workspaceName ? (
          <Chip
            label={workspaceName}
            color={workspaceColor || colors.accent}
            selected
          />
        ) : null}
        <Text
          style={[
            styles.timeAgo,
            { color: colors.textMuted, fontFamily: fonts.sans.regular },
          ]}
        >
          {formatTimeAgo(session.lastActive)}
        </Text>
      </View>

      {/* Row 2: Topic */}
      <Text
        style={[
          styles.topic,
          {
            color: session.topic ? colors.textSecondary : colors.textMuted,
            fontFamily: fonts.sans.regular,
          },
        ]}
        numberOfLines={1}
      >
        {session.topic || 'No topic'}
      </Text>

      {/* Row 3: Activity indicator + tags + needs-input badge */}
      <View style={styles.bottomRow}>
        <ActivityIndicator status={session.status} lastLog={lastLog} />

        {session.tags && session.tags.length > 0
          ? session.tags.slice(0, 3).map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))
          : null}

        {needsInput ? (
          <Badge variant="warning">Needs Input</Badge>
        ) : null}
      </View>
    </Pressable>
  );
});

export { SessionCard };

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    fontSize: 15,
    flexShrink: 1,
  },
  spacer: {
    flex: 1,
  },
  timeAgo: {
    fontSize: 12,
  },
  topic: {
    fontSize: 13,
    marginTop: 4,
    marginLeft: 20,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginLeft: 20,
    flexWrap: 'wrap',
  },
});
