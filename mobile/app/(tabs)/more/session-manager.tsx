/**
 * more/session-manager.tsx - Bulk session management screen.
 *
 * Provides a dashboard view of session status counts and a "Stop All Running"
 * bulk action. Uses Promise.allSettled for parallel stop operations with
 * progress feedback via toast notifications.
 *
 * Fulfills requirement SESS-18 (bulk stop running sessions).
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Alert, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { useAPIClient } from '@/hooks/useAPIClient';
import { useSessions } from '@/hooks/useSessions';
import { fonts } from '@/theme/fonts';
import {
  Badge,
  Button,
  Skeleton,
  EmptyState,
  StatusDot,
  Toast,
} from '@/components/ui';
import type { Session } from '@/types/api';

/**
 * SessionManagerScreen - Bulk session controls and status overview.
 *
 * Sections:
 *   1. Header with back navigation
 *   2. Status summary cards (running, stopped, idle, error counts)
 *   3. "Stop All Running" destructive button
 *   4. Session list showing name and status
 */
export default function SessionManagerScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const client = useAPIClient();
  const queryClient = useQueryClient();
  const { colors, spacing, radius } = theme;

  // Session data
  const sessionsQuery = useSessions();
  const sessions = sessionsQuery.data?.sessions ?? [];

  // Toast state
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVariant, setToastVariant] = useState<'success' | 'error'>('success');
  const [stopping, setStopping] = useState(false);

  // Count sessions by status
  const statusCounts = useMemo(() => {
    const counts = { running: 0, stopped: 0, idle: 0, error: 0 };
    for (const s of sessions) {
      if (s.status in counts) {
        counts[s.status as keyof typeof counts]++;
      }
    }
    return counts;
  }, [sessions]);

  /**
   * Stop all running sessions in parallel using Promise.allSettled.
   * Shows progress and result counts via toast.
   */
  const handleStopAll = useCallback(() => {
    const running = sessions.filter((s) => s.status === 'running');
    if (running.length === 0) return;

    Alert.alert(
      'Stop All Running Sessions',
      `This will stop ${running.length} running session${running.length > 1 ? 's' : ''}. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop All',
          style: 'destructive',
          onPress: async () => {
            if (!client) return;
            setStopping(true);
            setToastMessage(`Stopping ${running.length} sessions...`);
            setToastVariant('success');
            setToastVisible(true);

            const results = await Promise.allSettled(
              running.map((s) => client.stopSession(s.id))
            );

            const succeeded = results.filter((r) => r.status === 'fulfilled').length;
            const failed = results.filter((r) => r.status === 'rejected').length;

            queryClient.invalidateQueries({ queryKey: ['sessions'] });
            setStopping(false);

            if (failed === 0) {
              setToastMessage(`All ${succeeded} sessions stopped`);
              setToastVariant('success');
            } else {
              setToastMessage(`${succeeded} stopped, ${failed} failed`);
              setToastVariant('error');
            }
            setToastVisible(true);
          },
        },
      ]
    );
  }, [sessions, client, queryClient]);

  /**
   * Render a compact session row with status and name.
   * @param item - Session data
   */
  const renderItem = useCallback(
    ({ item }: { item: Session }) => (
      <View
        style={[
          styles.sessionRow,
          { backgroundColor: colors.surface0, borderRadius: radius.md, padding: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.xs },
        ]}
      >
        <StatusDot status={item.status} size="sm" />
        <Text
          style={[styles.sessionName, { color: colors.textPrimary, fontFamily: fonts.sans.regular }]}
          numberOfLines={1}
        >
          {item.name}
        </Text>
        <Text
          style={[styles.sessionStatus, { color: colors.textMuted, fontFamily: fonts.sans.regular }]}
        >
          {item.status}
        </Text>
      </View>
    ),
    [colors, radius, spacing]
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
            Session Manager
          </Text>
        </View>
        <View style={{ padding: spacing.md, gap: spacing.sm }}>
          <Skeleton width="100%" height={60} />
          <Skeleton width="100%" height={40} />
          <Skeleton width="100%" height={200} />
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
          Session Manager
        </Text>
      </View>

      {/* Status summary */}
      <View style={[styles.summaryRow, { paddingHorizontal: spacing.md, marginBottom: spacing.md }]}>
        <Badge variant="success">{`${statusCounts.running} running`}</Badge>
        <Badge>{`${statusCounts.stopped} stopped`}</Badge>
        <Badge variant="warning">{`${statusCounts.idle} idle`}</Badge>
        <Badge variant="error">{`${statusCounts.error} error`}</Badge>
      </View>

      {/* Bulk stop button */}
      {statusCounts.running > 0 ? (
        <View style={[styles.actionRow, { paddingHorizontal: spacing.md, marginBottom: spacing.md }]}>
          <Button
            variant="danger"
            onPress={handleStopAll}
            loading={stopping}
            disabled={stopping}
          >
            {`Stop All Running (${statusCounts.running})`}
          </Button>
        </View>
      ) : null}

      {/* Session list */}
      {sessions.length === 0 ? (
        <EmptyState
          title="No Sessions"
          description="No sessions to manage. Create sessions from the Sessions tab."
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

      <Toast
        visible={toastVisible}
        message={toastMessage}
        variant={toastVariant}
        onDismiss={() => setToastVisible(false)}
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
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionRow: {},
  listContent: {
    paddingBottom: 16,
    paddingTop: 8,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sessionName: {
    fontSize: 14,
    flex: 1,
  },
  sessionStatus: {
    fontSize: 12,
  },
});
