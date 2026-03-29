/**
 * QuickSwitcher.tsx - Modal quick access dialog for fast session navigation.
 *
 * Provides a ModalSheet-based overlay with integrated search. When the
 * query is empty, shows the 5 most recent sessions. When typing, shows
 * live keyword search results. Each row shows the session name, status dot,
 * and workspace name. Tapping a row navigates to the session detail and
 * closes the modal.
 *
 * Designed to be triggered from a search icon button in the sessions
 * list header.
 */

import React, { useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList } from 'react-native';
import { useRouter } from 'expo-router';

import { useTheme } from '@/hooks/useTheme';
import { useSearch } from '@/hooks/useSearch';
import { useSessions } from '@/hooks/useSessions';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { fonts } from '@/theme/fonts';
import { ModalSheet, SearchBar, StatusDot, Skeleton } from '@/components/ui';
import type { Session, SearchResult, Workspace } from '@/types/api';

export interface QuickSwitcherProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** Called when the modal should close */
  onClose: () => void;
}

/**
 * QuickSwitcherSessionRow - A single session row in the quick switcher.
 *
 * Shows session name with status dot and optional workspace name.
 * Memoized to avoid unnecessary re-renders in the list.
 *
 * @param props.session - Session data to display
 * @param props.workspaceName - Optional workspace name label
 * @param props.onPress - Callback with session ID when pressed
 */
const QuickSwitcherSessionRow = React.memo(function QuickSwitcherSessionRow({
  session,
  workspaceName,
  onPress,
}: {
  session: Session;
  workspaceName?: string;
  onPress: (id: string) => void;
}) {
  const { theme } = useTheme();

  return (
    <Pressable
      onPress={() => onPress(session.id)}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed
            ? theme.colors.surface1
            : 'transparent',
        },
      ]}
    >
      <StatusDot status={session.status as any} size="sm" />
      <View style={styles.rowText}>
        <Text
          style={[
            styles.sessionName,
            {
              color: theme.colors.textPrimary,
              fontFamily: fonts.sans.medium,
            },
          ]}
          numberOfLines={1}
        >
          {session.name}
        </Text>
        {workspaceName ? (
          <Text
            style={[
              styles.workspaceName,
              {
                color: theme.colors.textMuted,
                fontFamily: fonts.sans.regular,
              },
            ]}
            numberOfLines={1}
          >
            {workspaceName}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

/**
 * QuickSwitcherSearchRow - A search result row in the quick switcher.
 *
 * Shows session name and a brief message preview. Used when the user
 * has typed a search query.
 *
 * @param props.result - Search result data
 * @param props.onPress - Callback with session ID when pressed
 */
const QuickSwitcherSearchRow = React.memo(function QuickSwitcherSearchRow({
  result,
  onPress,
}: {
  result: SearchResult;
  onPress: (id: string) => void;
}) {
  const { theme } = useTheme();

  return (
    <Pressable
      onPress={() => onPress(result.sessionId)}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed
            ? theme.colors.surface1
            : 'transparent',
        },
      ]}
    >
      <View style={styles.rowText}>
        <Text
          style={[
            styles.sessionName,
            {
              color: theme.colors.textPrimary,
              fontFamily: fonts.sans.medium,
            },
          ]}
          numberOfLines={1}
        >
          {result.sessionName}
        </Text>
        <Text
          style={[
            styles.workspaceName,
            {
              color: theme.colors.textMuted,
              fontFamily: fonts.sans.regular,
            },
          ]}
          numberOfLines={1}
        >
          {result.message}
        </Text>
      </View>
    </Pressable>
  );
});

/**
 * QuickSwitcher - Modal overlay for fast session navigation.
 *
 * When query is empty: shows "Recent Sessions" with the 5 most recent.
 * When query has text: shows live keyword search results.
 *
 * @param props - QuickSwitcher configuration
 */
export function QuickSwitcher({ visible, onClose }: QuickSwitcherProps) {
  const { theme } = useTheme();
  const router = useRouter();

  // Search hook for live filtering
  const { query, setQuery, results, isLoading: searchLoading } = useSearch({
    mode: 'keyword',
  });

  // Recent sessions for the empty state
  const recentQuery = useSessions('recent', { count: 5 });
  const recentSessions = recentQuery.data?.sessions ?? [];

  // Workspace lookup for labels
  const workspacesQuery = useWorkspaces();
  const workspaceMap = useMemo(() => {
    const map: Record<string, Workspace> = {};
    for (const ws of workspacesQuery.data?.workspaces ?? []) {
      map[ws.id] = ws;
    }
    return map;
  }, [workspacesQuery.data]);

  const hasQuery = query.length >= 2;

  /** Navigate to session and close the modal */
  const handleSessionPress = useCallback(
    (id: string) => {
      onClose();
      router.push(`/sessions/${id}` as any);
    },
    [router, onClose]
  );

  /** Render a recent session row */
  const renderRecentItem = useCallback(
    ({ item }: { item: Session }) => (
      <QuickSwitcherSessionRow
        session={item}
        workspaceName={workspaceMap[item.workspaceId]?.name}
        onPress={handleSessionPress}
      />
    ),
    [workspaceMap, handleSessionPress]
  );

  /** Render a search result row */
  const renderSearchItem = useCallback(
    ({ item }: { item: SearchResult }) => (
      <QuickSwitcherSearchRow result={item} onPress={handleSessionPress} />
    ),
    [handleSessionPress]
  );

  return (
    <ModalSheet visible={visible} onClose={onClose} title="Quick Switcher">
      {/* Search input */}
      <SearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Search sessions..."
      />

      <View style={styles.content}>
        {/* Section header */}
        <Text
          style={[
            styles.sectionTitle,
            {
              color: theme.colors.textSecondary,
              fontFamily: fonts.sans.medium,
            },
          ]}
        >
          {hasQuery ? 'Search Results' : 'Recent Sessions'}
        </Text>

        {/* Loading skeleton */}
        {(hasQuery ? searchLoading : recentQuery.isLoading) ? (
          <View style={styles.skeletonList}>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} width="100%" height={44} />
            ))}
          </View>
        ) : hasQuery ? (
          /* Search results */
          results.length > 0 ? (
            <FlatList
              data={results}
              renderItem={renderSearchItem}
              keyExtractor={(item) => `${item.sessionId}-${item.timestamp}`}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
            />
          ) : (
            <Text
              style={[
                styles.emptyText,
                {
                  color: theme.colors.textMuted,
                  fontFamily: fonts.sans.regular,
                },
              ]}
            >
              No results for "{query}"
            </Text>
          )
        ) : (
          /* Recent sessions */
          recentSessions.length > 0 ? (
            <FlatList
              data={recentSessions}
              renderItem={renderRecentItem}
              keyExtractor={(item) => item.id}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
            />
          ) : (
            <Text
              style={[
                styles.emptyText,
                {
                  color: theme.colors.textMuted,
                  fontFamily: fonts.sans.regular,
                },
              ]}
            >
              No recent sessions
            </Text>
          )
        )}
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    marginTop: 12,
    maxHeight: 320,
  },
  sectionTitle: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  rowText: {
    flex: 1,
  },
  sessionName: {
    fontSize: 15,
  },
  workspaceName: {
    fontSize: 12,
    marginTop: 1,
  },
  list: {
    maxHeight: 260,
  },
  skeletonList: {
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
  },
});
