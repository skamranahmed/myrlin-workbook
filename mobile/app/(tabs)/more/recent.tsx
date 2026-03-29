/**
 * more/recent.tsx - Recently active sessions screen.
 *
 * Displays the 20 most recently active sessions using the "recent" mode
 * of the useSessions hook. Each session renders as a SessionCard with
 * tap-to-navigate to the session detail screen.
 *
 * Fulfills requirement SESS-14 (recently active sessions view).
 */

import React, { useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { useSessions } from '@/hooks/useSessions';
import { fonts } from '@/theme/fonts';
import { EmptyState, Skeleton } from '@/components/ui';
import { SessionCard } from '@/components/sessions/SessionCard';
import type { Session } from '@/types/api';

/**
 * RecentSessionsScreen - FlashList of the 20 most recently active sessions.
 *
 * Features:
 *   - Pull-to-refresh
 *   - Tap navigates to session detail
 *   - Empty state when no recent sessions exist
 */
export default function RecentSessionsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { colors, spacing } = theme;

  // Fetch recent sessions (last 20)
  const sessionsQuery = useSessions('recent', { count: 20 });
  const sessions = sessionsQuery.data?.sessions ?? [];

  /**
   * Navigate to session detail on card tap.
   * @param id - Session ID
   */
  const handlePress = useCallback(
    (id: string) => {
      router.push(`/sessions/${id}` as any);
    },
    [router]
  );

  /**
   * No-op for long press (actions handled on detail screen).
   */
  const handleLongPress = useCallback((_id: string) => {}, []);

  /**
   * Render a SessionCard for each recent session.
   * @param item - Session data
   */
  const renderItem = useCallback(
    ({ item }: { item: Session }) => (
      <SessionCard
        session={item}
        onPress={handlePress}
        onLongPress={handleLongPress}
        showWorkspace
      />
    ),
    [handlePress, handleLongPress]
  );

  const keyExtractor = useCallback((item: Session) => item.id, []);

  // Loading state
  if (sessionsQuery.isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.base }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary, fontFamily: fonts.sans.semibold }]}>
            Recent Sessions
          </Text>
        </View>
        <View style={{ padding: spacing.md, gap: spacing.sm }}>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width="100%" height={80} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.base }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.textPrimary, fontFamily: fonts.sans.semibold }]}>
          Recent Sessions
        </Text>
      </View>

      {sessions.length === 0 ? (
        <EmptyState
          title="No Recent Sessions"
          description="Sessions will appear here once they have activity."
        />
      ) : (
        <FlashList
          data={sessions}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          refreshing={sessionsQuery.isRefetching}
          onRefresh={() => sessionsQuery.refetch()}
          contentContainerStyle={styles.listContent}
        />
      )}
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
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 4,
  },
  backButton: {
    padding: 8,
  },
  title: {
    fontSize: 22,
  },
  listContent: {
    paddingBottom: 16,
    paddingTop: 8,
  },
});
