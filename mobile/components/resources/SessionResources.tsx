/**
 * SessionResources.tsx - Per-session resource usage list with kill action.
 *
 * Displays a list of running Claude sessions with their CPU%, memory,
 * PID, and port badges. Each row has a kill button that shows an
 * ActionSheet confirmation before terminating the process.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import {
  Card,
  Badge,
  SectionHeader,
  StatusDot,
  EmptyState,
  ActionSheet,
} from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { useKillProcess } from '@/hooks/useResources';
import type { ClaudeSessionResource } from '@/types/api';

/** Props for the SessionResources component */
interface SessionResourcesProps {
  /** List of Claude session resource entries */
  sessions: ClaudeSessionResource[];
}

/**
 * Get badge variant for CPU percentage using standard thresholds.
 * Green below 50%, yellow 50-80%, red above 80%.
 * @param percent - CPU usage percentage
 * @returns Badge variant string
 */
function getCpuBadgeVariant(percent: number): 'success' | 'warning' | 'error' {
  if (percent < 50) return 'success';
  if (percent < 80) return 'warning';
  return 'error';
}

/**
 * SessionResources - Displays per-session resource usage in a list.
 *
 * Each row shows session name, workspace, working directory, CPU/memory
 * badges, PID, ports, and a kill button. Kill triggers an ActionSheet
 * confirmation dialog before calling the API.
 *
 * @param props.sessions - Array of ClaudeSessionResource from the server
 */
export function SessionResources({ sessions }: SessionResourcesProps) {
  const { theme } = useTheme();
  const { colors, spacing, radius, typography } = theme;
  const killMutation = useKillProcess();
  const [killTarget, setKillTarget] = useState<ClaudeSessionResource | null>(null);

  /** Handle kill confirmation from ActionSheet */
  const handleConfirmKill = useCallback(() => {
    if (killTarget) {
      killMutation.mutate(killTarget.pid);
      setKillTarget(null);
    }
  }, [killTarget, killMutation]);

  /** Render a single session resource row */
  const renderItem = useCallback(
    ({ item }: { item: ClaudeSessionResource }) => (
      <Card style={{ ...styles.rowCard, backgroundColor: colors.surface0 }}>
        <View style={styles.rowContent}>
          {/* Left: session info */}
          <View style={styles.rowInfo}>
            <View style={styles.nameRow}>
              <StatusDot status={item.status === 'running' ? 'running' : 'stopped'} />
              <Text
                style={[styles.sessionName, { color: colors.textPrimary, fontFamily: typography.fontSans }]}
                numberOfLines={1}
              >
                {item.sessionName}
              </Text>
            </View>
            {item.workspaceName && (
              <Text
                style={[styles.workspace, { color: colors.textSecondary, fontFamily: typography.fontSans }]}
                numberOfLines={1}
              >
                {item.workspaceName}
              </Text>
            )}
            {item.workingDir && (
              <Text
                style={[styles.workingDir, { color: colors.textTertiary, fontFamily: typography.fontMono }]}
                numberOfLines={1}
              >
                {item.workingDir}
              </Text>
            )}
            {/* Stats badges row */}
            <View style={styles.badgeRow}>
              <Badge variant={getCpuBadgeVariant(item.cpuPercent)}>
                {`CPU ${Math.round(item.cpuPercent)}%`}
              </Badge>
              <Badge variant="default">
                {`${Math.round(item.memoryMB)} MB`}
              </Badge>
              <Badge variant="default">
                {`PID ${item.pid}`}
              </Badge>
              {item.ports.map((port) => (
                <Badge key={String(port)} variant="default">
                  {`:${port}`}
                </Badge>
              ))}
            </View>
          </View>

          {/* Right: kill button */}
          <Pressable
            style={[styles.killButton, { backgroundColor: colors.red + '18', borderRadius: radius.sm }]}
            onPress={() => setKillTarget(item)}
            hitSlop={8}
          >
            <Text style={[styles.killText, { color: colors.red, fontFamily: typography.fontSans }]}>
              Kill
            </Text>
          </Pressable>
        </View>
      </Card>
    ),
    [colors, typography, radius]
  );

  return (
    <View style={styles.container}>
      <SectionHeader
        title={`Claude Sessions (${sessions.length})`}
      />

      {sessions.length === 0 ? (
        <EmptyState
          icon={<Ionicons name="terminal-outline" size={32} color={colors.textTertiary} />}
          title="No Running Sessions"
          description="Start a session to see resource usage here"
        />
      ) : (
        <View style={styles.listContainer}>
          <FlashList
            data={sessions}
            renderItem={renderItem}
            keyExtractor={(item) => item.sessionId}
            scrollEnabled={false}
          />
        </View>
      )}

      {/* Kill confirmation ActionSheet */}
      {killTarget && (
        <ActionSheet
          visible={!!killTarget}
          onClose={() => setKillTarget(null)}
          actions={[
            {
              label: `Kill PID ${killTarget.pid}`,
              onPress: handleConfirmKill,
              destructive: true,
            },
            {
              label: 'Cancel',
              onPress: () => setKillTarget(null),
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  listContainer: {
    minHeight: 100,
  },
  rowCard: {
    marginBottom: 8,
    padding: 12,
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowInfo: {
    flex: 1,
    gap: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sessionName: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  workspace: {
    fontSize: 13,
    marginLeft: 18,
  },
  workingDir: {
    fontSize: 11,
    marginLeft: 18,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
    marginLeft: 18,
  },
  killButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  killText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
