/**
 * more/conflicts.tsx - Conflict center screen showing file conflicts.
 *
 * Displays a list of files that are being edited by multiple sessions
 * simultaneously. Each conflict shows the file path, involved sessions
 * (as pressable badges), and detection time.
 *
 * Polls the server every 30 seconds for updated conflict data since
 * there is no SSE event for conflict changes.
 *
 * Data flow:
 *   useQuery (30s poll) -> getConflicts() -> FlashList renders ConflictRows
 */

import React, { useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { useTheme } from '@/hooks/useTheme';
import { useAPIClient } from '@/hooks/useAPIClient';
import { fonts } from '@/theme/fonts';
import { Badge, Skeleton, EmptyState } from '@/components/ui';
import { ConflictRow } from '@/components/conflicts/ConflictRow';
import type { FileConflict } from '@/types/api';

/** Polling interval for conflict data (30 seconds) */
const CONFLICT_POLL_INTERVAL = 30000;

/**
 * ConflictsScreen - Conflict center listing all detected file conflicts.
 *
 * Layout (top to bottom):
 *   1. Header: back button + "File Conflicts" title + count badge
 *   2. FlashList of ConflictRow items
 *   3. Pull-to-refresh support
 *   4. States: loading skeletons, empty with green checkmark, error with retry
 */
export default function ConflictsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const client = useAPIClient();

  // Fetch conflicts with polling
  const conflictsQuery = useQuery({
    queryKey: ['conflicts'],
    queryFn: () => client!.getConflicts(),
    enabled: !!client,
    staleTime: CONFLICT_POLL_INTERVAL,
    refetchInterval: CONFLICT_POLL_INTERVAL,
  });

  const conflicts = conflictsQuery.data?.conflicts ?? [];

  /** Navigate to session detail when a session chip is pressed */
  const handleSessionPress = useCallback(
    (sessionId: string) => {
      router.push(`/sessions/${sessionId}` as any);
    },
    [router]
  );

  /** Render a single conflict row */
  const renderItem = useCallback(
    ({ item }: { item: FileConflict }) => (
      <ConflictRow conflict={item} onSessionPress={handleSessionPress} />
    ),
    [handleSessionPress]
  );

  const keyExtractor = useCallback(
    (item: FileConflict) => item.file,
    []
  );

  /** Render the main content based on query state */
  const renderContent = () => {
    // Loading state
    if (conflictsQuery.isLoading) {
      return (
        <View style={styles.skeletonContainer}>
          {[1, 2, 3].map((i) => (
            <View key={i} style={styles.skeletonCard}>
              <Skeleton width="100%" height={100} />
            </View>
          ))}
        </View>
      );
    }

    // Error state
    if (conflictsQuery.isError) {
      return (
        <EmptyState
          icon={
            <Ionicons
              name="warning-outline"
              size={48}
              color={theme.colors.error}
            />
          }
          title="Could not load conflicts"
          description="Check your connection and try again."
          action={{
            label: 'Retry',
            onPress: () => conflictsQuery.refetch(),
          }}
        />
      );
    }

    // Empty state (no conflicts is good)
    if (conflicts.length === 0) {
      return (
        <EmptyState
          icon={
            <Ionicons
              name="checkmark-circle-outline"
              size={48}
              color={theme.colors.success}
            />
          }
          title="No file conflicts detected"
          description="All sessions are editing unique files. No overlapping edits found."
        />
      );
    }

    // Conflict list
    return (
      <FlashList
        data={conflicts}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        refreshing={conflictsQuery.isRefetching}
        onRefresh={() => conflictsQuery.refetch()}
        contentContainerStyle={styles.listContent}
      />
    );
  };

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.container, { backgroundColor: theme.colors.base }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons
            name="chevron-back"
            size={24}
            color={theme.colors.textPrimary}
          />
        </Pressable>
        <Text
          style={[
            styles.title,
            {
              color: theme.colors.textPrimary,
              fontFamily: fonts.sans.semibold,
            },
          ]}
        >
          File Conflicts
        </Text>
        {conflicts.length > 0 ? (
          <Badge variant="error">{String(conflicts.length)}</Badge>
        ) : null}
        <View style={styles.headerSpacer} />
      </View>

      {/* Content */}
      <View style={styles.contentArea}>{renderContent()}</View>
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
    paddingBottom: 12,
  },
  title: {
    fontSize: 22,
    flex: 1,
  },
  headerSpacer: {
    width: 24,
  },
  contentArea: {
    flex: 1,
  },
  skeletonContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
  },
  skeletonCard: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: 16,
  },
});
