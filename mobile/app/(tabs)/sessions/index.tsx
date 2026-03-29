/**
 * sessions/index.tsx - Full session list screen with real-time updates.
 *
 * Replaces the Phase 2 placeholder with a complete session list powered by
 * FlashList, TanStack Query, and SSE. Features workspace filter chips,
 * segmented control for All/Recent views, pull-to-refresh, and action sheets
 * for session operations.
 *
 * Data flow:
 *   SSE events -> useSSE invalidates query cache -> useSessions refetches
 *   -> FlashList re-renders with fresh data via SessionCard (React.memo)
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';

import { useTheme } from '@/hooks/useTheme';
import { useSSE } from '@/hooks/useSSE';
import { useSessions } from '@/hooks/useSessions';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { useUIStore } from '@/stores/ui-store';
import { fonts } from '@/theme/fonts';
import {
  Chip,
  SegmentedControl,
  Skeleton,
  EmptyState,
  Badge,
  ActionSheet,
  type ActionSheetAction,
} from '@/components/ui';
import { SessionCard } from '@/components/sessions/SessionCard';
import type { Session, Workspace } from '@/types/api';

/** Segment labels for the All/Recent toggle */
const VIEW_SEGMENTS = ['All', 'Recent'];

/**
 * Sort sessions by lastActive timestamp in descending order (newest first).
 * @param sessions - Array of sessions to sort
 * @returns New sorted array (does not mutate input)
 */
function sortByRecent(sessions: Session[]): Session[] {
  return [...sessions].sort(
    (a, b) => new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime()
  );
}

/**
 * Sort sessions by name alphabetically.
 * @param sessions - Array of sessions to sort
 * @returns New sorted array
 */
function sortByName(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Sort sessions by status priority: running > idle > error > stopped.
 * @param sessions - Array of sessions to sort
 * @returns New sorted array
 */
function sortByStatus(sessions: Session[]): Session[] {
  const priority: Record<string, number> = { running: 0, idle: 1, error: 2, stopped: 3 };
  return [...sessions].sort(
    (a, b) => (priority[a.status] ?? 4) - (priority[b.status] ?? 4)
  );
}

/**
 * SessionsScreen - Main session list screen with real-time SSE updates.
 *
 * Layout (top to bottom):
 *   1. Header: "Sessions" title + running count badge
 *   2. Workspace filter chips (horizontal scroll)
 *   3. SegmentedControl: All | Recent
 *   4. FlashList of SessionCards with pull-to-refresh
 *   5. Loading/Error/Empty state handling
 *
 * The useSSE hook runs at this level to maintain the SSE connection
 * while the sessions tab is active.
 */
export default function SessionsScreen() {
  const { theme } = useTheme();
  const router = useRouter();

  // SSE connection for real-time updates (manages its own lifecycle)
  useSSE();

  // View state
  const [viewIndex, setViewIndex] = useState(0);
  const selectedFilter = useUIStore((s) => s.selectedWorkspaceFilter);
  const setFilter = useUIStore((s) => s.setWorkspaceFilter);
  const sortOrder = useUIStore((s) => s.sessionSortOrder);

  // Action sheet state
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // Data queries
  const isRecent = viewIndex === 1;
  const sessionsQuery = useSessions(
    isRecent ? 'recent' : selectedFilter ? 'workspace' : 'all',
    selectedFilter ? { workspaceId: selectedFilter } : undefined
  );
  const workspacesQuery = useWorkspaces();

  const sessions = sessionsQuery.data?.sessions ?? [];
  const workspaces = workspacesQuery.data?.workspaces ?? [];

  // Build workspace lookup for SessionCard badges
  const workspaceMap = useMemo(() => {
    const map: Record<string, Workspace> = {};
    for (const ws of workspaces) {
      map[ws.id] = ws;
    }
    return map;
  }, [workspaces]);

  // Sort and filter sessions
  const sortedSessions = useMemo(() => {
    switch (sortOrder) {
      case 'name':
        return sortByName(sessions);
      case 'status':
        return sortByStatus(sessions);
      case 'recent':
      default:
        return sortByRecent(sessions);
    }
  }, [sessions, sortOrder]);

  // Count running sessions for the header badge
  const runningCount = useMemo(
    () => sessions.filter((s) => s.status === 'running').length,
    [sessions]
  );

  // Navigation callbacks
  const handleSessionPress = useCallback(
    (id: string) => {
      router.push(`/sessions/${id}` as any);
    },
    [router]
  );

  const handleSessionLongPress = useCallback((id: string) => {
    setSelectedSessionId(id);
    setActionSheetVisible(true);
  }, []);

  // Action sheet actions (wired as stubs, actual mutations in Plan 02)
  const actionSheetActions = useMemo<ActionSheetAction[]>(() => {
    const selected = sessions.find((s) => s.id === selectedSessionId);
    if (!selected) return [];

    const actions: ActionSheetAction[] = [];

    if (selected.status === 'stopped' || selected.status === 'error') {
      actions.push({ label: 'Start', onPress: () => {} });
    }
    if (selected.status === 'running') {
      actions.push({ label: 'Stop', onPress: () => {} });
      actions.push({ label: 'Restart', onPress: () => {} });
    }

    actions.push({ label: 'Rename', onPress: () => {} });
    actions.push({ label: 'Move to Workspace', onPress: () => {} });
    actions.push({
      label: 'Delete',
      destructive: true,
      onPress: () => {},
    });

    return actions;
  }, [selectedSessionId, sessions]);

  // Render item for FlashList
  const renderItem = useCallback(
    ({ item }: { item: Session }) => {
      const ws = workspaceMap[item.workspaceId];
      return (
        <SessionCard
          session={item}
          onPress={handleSessionPress}
          onLongPress={handleSessionLongPress}
          showWorkspace={!selectedFilter}
          workspaceName={ws?.name}
          workspaceColor={ws?.color}
        />
      );
    },
    [workspaceMap, handleSessionPress, handleSessionLongPress, selectedFilter]
  );

  const keyExtractor = useCallback((item: Session) => item.id, []);

  // Loading state: skeleton placeholders
  if (sessionsQuery.isLoading) {
    return (
      <SafeAreaView
        edges={['bottom']}
        style={[styles.container, { backgroundColor: theme.colors.base }]}
      >
        <View style={styles.header}>
          <Text
            style={[
              styles.title,
              { color: theme.colors.textPrimary, fontFamily: fonts.sans.semibold },
            ]}
          >
            Sessions
          </Text>
        </View>
        <View style={styles.skeletonContainer}>
          {[1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={styles.skeletonCard}>
              <Skeleton width="100%" height={80} />
            </View>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (sessionsQuery.isError) {
    return (
      <SafeAreaView
        edges={['bottom']}
        style={[styles.container, { backgroundColor: theme.colors.base }]}
      >
        <View style={styles.header}>
          <Text
            style={[
              styles.title,
              { color: theme.colors.textPrimary, fontFamily: fonts.sans.semibold },
            ]}
          >
            Sessions
          </Text>
        </View>
        <EmptyState
          title="Connection Error"
          description="Could not load sessions from the server. Check your connection and try again."
          action={{
            label: 'Retry',
            onPress: () => sessionsQuery.refetch(),
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.container, { backgroundColor: theme.colors.base }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text
          style={[
            styles.title,
            { color: theme.colors.textPrimary, fontFamily: fonts.sans.semibold },
          ]}
        >
          Sessions
        </Text>
        {runningCount > 0 ? (
          <Badge variant="success">{`${runningCount} running`}</Badge>
        ) : null}
      </View>

      {/* Workspace filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipBar}
      >
        <Chip
          label="All"
          selected={!selectedFilter}
          onPress={() => setFilter(null)}
        />
        {workspaces.map((ws) => (
          <Chip
            key={ws.id}
            label={ws.name}
            selected={selectedFilter === ws.id}
            onPress={() => setFilter(ws.id)}
            color={ws.color || undefined}
          />
        ))}
      </ScrollView>

      {/* Segmented control: All / Recent */}
      <View style={styles.segmentContainer}>
        <SegmentedControl
          segments={VIEW_SEGMENTS}
          selectedIndex={viewIndex}
          onSelect={setViewIndex}
        />
      </View>

      {/* Session list or empty state */}
      {sortedSessions.length === 0 ? (
        <EmptyState
          title="No sessions"
          description={
            selectedFilter
              ? 'No sessions in this workspace yet.'
              : 'Create your first session to get started.'
          }
          action={{
            label: 'Create Session',
            onPress: () => {},
          }}
        />
      ) : (
        <FlashList
          data={sortedSessions}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          refreshing={sessionsQuery.isRefetching}
          onRefresh={() => sessionsQuery.refetch()}
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* Action sheet for long-press */}
      <ActionSheet
        visible={actionSheetVisible}
        onClose={() => setActionSheetVisible(false)}
        actions={actionSheetActions}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  title: {
    fontSize: 28,
  },
  chipBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  segmentContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  listContent: {
    paddingBottom: 16,
  },
  skeletonContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  skeletonCard: {
    borderRadius: 12,
    overflow: 'hidden',
  },
});
