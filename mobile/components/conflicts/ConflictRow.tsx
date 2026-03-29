/**
 * ConflictRow.tsx - List item for displaying a file conflict.
 *
 * Shows the conflicting file path (monospace, truncated from left to show
 * the filename), the number of sessions editing it, session name chips
 * (pressable to navigate), and the detection timestamp.
 *
 * Memoized with React.memo to avoid unnecessary re-renders in FlashList.
 */

import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import { Badge } from '@/components/ui';
import type { FileConflict } from '@/types/api';

export interface ConflictRowProps {
  /** The file conflict data to render */
  conflict: FileConflict;
  /** Called when a session chip is pressed with that session's ID */
  onSessionPress: (id: string) => void;
}

/**
 * Format a timestamp into a relative time string (e.g. "2h ago").
 *
 * @param timestamp - ISO timestamp string
 * @returns Human-readable relative time
 */
function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

/**
 * ConflictRow - Renders a single file conflict card.
 *
 * Layout:
 *   1. File path (monospace, bold, primary color)
 *   2. "X sessions editing this file" label
 *   3. Row of pressable session name badges
 *   4. Detection timestamp (muted)
 *
 * @param props - ConflictRow configuration
 */
export const ConflictRow = React.memo(function ConflictRow({
  conflict,
  onSessionPress,
}: ConflictRowProps) {
  const { theme } = useTheme();

  const sessionCount = conflict.sessions.length;

  const containerStyle = useMemo(
    () => [
      styles.container,
      {
        backgroundColor: theme.colors.surface0,
        borderColor: theme.colors.borderSubtle,
      },
    ],
    [theme.colors]
  );

  return (
    <View style={containerStyle}>
      {/* File path */}
      <Text
        style={[
          styles.filePath,
          {
            color: theme.colors.textPrimary,
            fontFamily: fonts.mono.bold,
          },
        ]}
        numberOfLines={1}
        ellipsizeMode="head"
      >
        {conflict.file}
      </Text>

      {/* Session count label */}
      <Text
        style={[
          styles.countLabel,
          {
            color: theme.colors.textSecondary,
            fontFamily: fonts.sans.regular,
          },
        ]}
      >
        {sessionCount} {sessionCount === 1 ? 'session' : 'sessions'} editing this file
      </Text>

      {/* Session chips */}
      <View style={styles.chipsRow}>
        {conflict.sessions.map((session) => (
          <Pressable
            key={session.id}
            onPress={() => onSessionPress(session.id)}
          >
            <Badge variant="info">{session.name}</Badge>
          </Pressable>
        ))}
      </View>

      {/* Detection timestamp */}
      <Text
        style={[
          styles.timestamp,
          {
            color: theme.colors.textMuted,
            fontFamily: fonts.sans.regular,
          },
        ]}
      >
        Detected {formatRelativeTime(conflict.detectedAt)}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  filePath: {
    fontSize: 13,
    marginBottom: 4,
  },
  countLabel: {
    fontSize: 13,
    marginBottom: 8,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  timestamp: {
    fontSize: 11,
  },
});
