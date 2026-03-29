/**
 * sessions/[id].tsx - Session detail screen with metadata, cost, logs, and subagents.
 *
 * Displays comprehensive session information in a scrollable layout:
 * status controls, metadata grid, tags, cost breakdown with TokenBar,
 * activity logs (collapsible), and subagent tree. All session lifecycle
 * operations are available via the overflow menu (SessionActions).
 *
 * Data sources:
 *   - useSession(id) for core session data
 *   - useQuery(['session-cost', id]) for cost breakdown
 *   - useQuery(['session-subagents', id]) for subagent tree
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { useSession, useUpdateSession, useStartSession, useStopSession, useRestartSession } from '@/hooks/useSessions';
import { useAPIClient } from '@/hooks/useAPIClient';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { fonts } from '@/theme/fonts';
import {
  StatusDot,
  Badge,
  Button,
  SectionHeader,
  MetaRow,
  TokenBar,
  Skeleton,
  EmptyState,
  Input,
  ModalSheet,
  Toast,
} from '@/components/ui';
import { SessionActions } from '@/components/sessions/SessionActions';
import type { Session, SessionCost, Subagent } from '@/types/api';

/**
 * Format an ISO timestamp as a relative "time ago" string.
 * @param isoDate - ISO 8601 timestamp
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
 * Format an ISO timestamp as a readable date string.
 * @param isoDate - ISO 8601 timestamp
 * @returns Formatted date (e.g. "Mar 28, 2026 3:45 PM")
 */
function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Format a cost value as a USD string.
 * @param cost - Cost in dollars
 * @returns Formatted cost (e.g. "$1.23")
 */
function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

/**
 * Compute token proportions for the TokenBar component.
 * @param breakdown - Cost breakdown from the server
 * @returns Proportions summing to approximately 1
 */
function getTokenProportions(breakdown: SessionCost['breakdown']) {
  const total =
    breakdown.input.tokens +
    breakdown.output.tokens +
    breakdown.cacheRead.tokens +
    breakdown.cacheWrite.tokens;

  if (total === 0) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  return {
    input: breakdown.input.tokens / total,
    output: breakdown.output.tokens / total,
    cacheRead: breakdown.cacheRead.tokens / total,
    cacheWrite: breakdown.cacheWrite.tokens / total,
  };
}

/** Number of logs shown in collapsed state */
const COLLAPSED_LOG_COUNT = 5;

/**
 * SessionDetailScreen - Full session detail with metadata, cost, logs, subagents.
 *
 * Sections (top to bottom):
 *   1. Header: back button, session name, overflow menu
 *   2. Status: large status dot, label, action buttons
 *   3. Metadata: workspace, working dir, command, created, last active, PID
 *   4. Tags: horizontal badges with add/remove
 *   5. Cost: total cost, token bar, model breakdown
 *   6. Logs: last 20 entries, collapsible
 *   7. Subagents: tree view of child agents
 */
export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const router = useRouter();
  const client = useAPIClient();
  const queryClient = useQueryClient();

  // Core session data
  const sessionQuery = useSession(id!);
  const session = sessionQuery.data;

  // Workspace data for metadata display
  const workspacesQuery = useWorkspaces();
  const workspaceMap = useMemo(() => {
    const map: Record<string, { name: string; color: string }> = {};
    for (const ws of workspacesQuery.data?.workspaces ?? []) {
      map[ws.id] = { name: ws.name, color: ws.color };
    }
    return map;
  }, [workspacesQuery.data]);

  // Cost query
  const costQuery = useQuery({
    queryKey: ['session-cost', id],
    queryFn: () => client!.getSessionCost(id!),
    enabled: !!client && !!id,
    staleTime: 30000,
  });

  // Subagents query
  const subagentsQuery = useQuery({
    queryKey: ['session-subagents', id],
    queryFn: () => client!.getSessionSubagents(id!),
    enabled: !!client && !!id,
    staleTime: 15000,
  });

  // Mutations
  const startMutation = useStartSession();
  const stopMutation = useStopSession();
  const restartMutation = useRestartSession();
  const updateMutation = useUpdateSession();

  // UI state
  const [actionsVisible, setActionsVisible] = useState(false);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [subagentsExpanded, setSubagentsExpanded] = useState(true);
  const [tagInputVisible, setTagInputVisible] = useState(false);
  const [tagInputValue, setTagInputValue] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVariant, setToastVariant] = useState<'success' | 'error'>('success');

  const { colors, spacing, radius, typography } = theme;

  /**
   * Show a toast notification.
   * @param message - Toast text
   * @param variant - success or error
   */
  const showToast = useCallback((message: string, variant: 'success' | 'error') => {
    setToastMessage(message);
    setToastVariant(variant);
    setToastVisible(true);
  }, []);

  /**
   * Add a tag to the session.
   */
  const handleAddTag = useCallback(() => {
    if (!tagInputValue.trim() || !session) return;
    setTagInputVisible(false);
    const newTags = [...(session.tags || []), tagInputValue.trim()];
    setTagInputValue('');
    updateMutation.mutate(
      { id: session.id, data: { tags: newTags } },
      {
        onSuccess: () => showToast('Tag added', 'success'),
        onError: () => showToast('Failed to add tag', 'error'),
      }
    );
  }, [tagInputValue, session, updateMutation, showToast]);

  /**
   * Remove a tag from the session with confirmation.
   * @param tag - Tag string to remove
   */
  const handleRemoveTag = useCallback(
    (tag: string) => {
      if (!session) return;
      Alert.alert('Remove Tag', `Remove "${tag}" from this session?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            const newTags = session.tags.filter((t) => t !== tag);
            updateMutation.mutate(
              { id: session.id, data: { tags: newTags } },
              {
                onSuccess: () => showToast('Tag removed', 'success'),
                onError: () => showToast('Failed to remove tag', 'error'),
              }
            );
          },
        },
      ]);
    },
    [session, updateMutation, showToast]
  );

  // Loading state
  if (sessionQuery.isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.base }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>
          <Skeleton width={200} height={24} />
        </View>
        <View style={{ padding: spacing.md, gap: spacing.md }}>
          <Skeleton width="100%" height={60} />
          <Skeleton width="100%" height={120} />
          <Skeleton width="100%" height={80} />
          <Skeleton width="100%" height={60} />
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (sessionQuery.isError || !session) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.base }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>
        </View>
        <EmptyState
          title="Session Not Found"
          description="Could not load this session. It may have been deleted."
          action={{ label: 'Go Back', onPress: () => router.back() }}
        />
      </SafeAreaView>
    );
  }

  // Resolve workspace info
  const workspace = workspaceMap[session.workspaceId];

  // Cost data
  const cost = costQuery.data;
  const tokenProps = cost ? getTokenProportions(cost.breakdown) : null;

  // Subagents data
  const subagents = subagentsQuery.data?.subagents ?? [];

  // Logs (last 20, collapsible)
  const allLogs = session.logs ?? [];
  const recentLogs = allLogs.slice(-20).reverse();
  const visibleLogs = logsExpanded ? recentLogs : recentLogs.slice(0, COLLAPSED_LOG_COUNT);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.base }]}>
      {/* Header */}
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text
          style={[
            styles.headerTitle,
            { color: colors.textPrimary, fontFamily: fonts.sans.semibold },
          ]}
          numberOfLines={1}
        >
          {session.name}
        </Text>
        <View style={styles.spacer} />
        <Pressable onPress={() => setActionsVisible(true)} style={styles.overflowButton}>
          <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl * 2 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Status section */}
        <View style={[styles.statusSection, { backgroundColor: colors.surface0, borderRadius: radius.lg, padding: spacing.md }]}>
          <View style={styles.statusRow}>
            <StatusDot status={session.status} size="md" />
            <Text
              style={[
                styles.statusLabel,
                { color: colors.textPrimary, fontFamily: fonts.sans.semibold },
              ]}
            >
              {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
            </Text>
          </View>
          <View style={styles.statusButtons}>
            {(session.status === 'stopped' || session.status === 'error' || session.status === 'idle') ? (
              <Button
                size="sm"
                onPress={() =>
                  startMutation.mutate(session.id, {
                    onSuccess: () => showToast('Session started', 'success'),
                    onError: () => showToast('Failed to start', 'error'),
                  })
                }
              >
                Start
              </Button>
            ) : null}
            {session.status === 'running' ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() =>
                    stopMutation.mutate(session.id, {
                      onSuccess: () => showToast('Session stopped', 'success'),
                      onError: () => showToast('Failed to stop', 'error'),
                    })
                  }
                >
                  Stop
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() =>
                    restartMutation.mutate(session.id, {
                      onSuccess: () => showToast('Session restarted', 'success'),
                      onError: () => showToast('Failed to restart', 'error'),
                    })
                  }
                >
                  Restart
                </Button>
              </>
            ) : null}
          </View>
        </View>

        {/* Metadata section */}
        <SectionHeader title="Details" />
        <View style={[styles.metadataCard, { backgroundColor: colors.surface0, borderRadius: radius.lg }]}>
          <MetaRow
            label="Workspace"
            value={workspace?.name ?? 'Unknown'}
            icon={
              <View
                style={[
                  styles.workspaceDot,
                  { backgroundColor: workspace?.color || colors.accent },
                ]}
              />
            }
          />
          <MetaRow label="Working Dir" value={session.workingDir} />
          <MetaRow label="Command" value={session.command || 'claude'} />
          <MetaRow label="Created" value={formatDate(session.createdAt)} />
          <MetaRow label="Last Active" value={formatTimeAgo(session.lastActive)} />
          {session.pid ? (
            <MetaRow label="PID" value={String(session.pid)} />
          ) : null}
        </View>

        {/* Tags section */}
        <SectionHeader title="Tags" />
        <View style={styles.tagsRow}>
          {session.tags && session.tags.length > 0
            ? session.tags.map((tag) => (
                <Pressable key={tag} onPress={() => handleRemoveTag(tag)}>
                  <Badge>{tag}</Badge>
                </Pressable>
              ))
            : (
                <Text style={[styles.mutedText, { color: colors.textMuted, fontFamily: fonts.sans.regular }]}>
                  No tags
                </Text>
              )}
          <Pressable
            onPress={() => {
              setTagInputValue('');
              setTagInputVisible(true);
            }}
            style={[styles.addTagButton, { borderColor: colors.borderSubtle, borderRadius: radius.md }]}
          >
            <Ionicons name="add" size={16} color={colors.accent} />
            <Text style={[styles.addTagText, { color: colors.accent, fontFamily: fonts.sans.medium }]}>
              Add
            </Text>
          </Pressable>
        </View>

        {/* Cost section */}
        <SectionHeader title="Cost" />
        {costQuery.isLoading ? (
          <Skeleton width="100%" height={80} />
        ) : cost ? (
          <View style={[styles.costCard, { backgroundColor: colors.surface0, borderRadius: radius.lg, padding: spacing.md }]}>
            <Text
              style={[
                styles.costTotal,
                { color: colors.textPrimary, fontFamily: fonts.sans.bold },
              ]}
            >
              {formatCost(cost.totalCost)}
            </Text>
            <Text
              style={[
                styles.costSubtext,
                { color: colors.textMuted, fontFamily: fonts.sans.regular },
              ]}
            >
              {cost.messageCount} messages
            </Text>
            {tokenProps ? (
              <View style={styles.tokenBarContainer}>
                <TokenBar
                  input={tokenProps.input}
                  output={tokenProps.output}
                  cacheRead={tokenProps.cacheRead}
                  cacheWrite={tokenProps.cacheWrite}
                />
                <View style={styles.tokenLegend}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: colors.blue }]} />
                    <Text style={[styles.legendText, { color: colors.textSecondary, fontFamily: fonts.sans.regular }]}>
                      Input
                    </Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: colors.green }]} />
                    <Text style={[styles.legendText, { color: colors.textSecondary, fontFamily: fonts.sans.regular }]}>
                      Output
                    </Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: colors.teal }]} />
                    <Text style={[styles.legendText, { color: colors.textSecondary, fontFamily: fonts.sans.regular }]}>
                      Cache Read
                    </Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: colors.peach }]} />
                    <Text style={[styles.legendText, { color: colors.textSecondary, fontFamily: fonts.sans.regular }]}>
                      Cache Write
                    </Text>
                  </View>
                </View>
              </View>
            ) : null}
            {/* Model breakdown */}
            {Object.keys(cost.byModel).length > 0 ? (
              <View style={styles.modelBreakdown}>
                <Text
                  style={[
                    styles.modelBreakdownTitle,
                    { color: colors.textSecondary, fontFamily: fonts.sans.medium },
                  ]}
                >
                  By Model
                </Text>
                {Object.entries(cost.byModel).map(([model, data]) => (
                  <View key={model} style={styles.modelRow}>
                    <Text
                      style={[
                        styles.modelName,
                        { color: colors.textPrimary, fontFamily: fonts.mono.regular },
                      ]}
                      numberOfLines={1}
                    >
                      {model}
                    </Text>
                    <Text
                      style={[
                        styles.modelCost,
                        { color: colors.textSecondary, fontFamily: fonts.sans.medium },
                      ]}
                    >
                      {formatCost(data.cost)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : (
          <Text style={[styles.mutedText, { color: colors.textMuted, fontFamily: fonts.sans.regular }]}>
            No cost data available
          </Text>
        )}

        {/* Logs section */}
        <SectionHeader title="Recent Logs" />
        {recentLogs.length === 0 ? (
          <Text style={[styles.mutedText, { color: colors.textMuted, fontFamily: fonts.sans.regular }]}>
            No logs yet
          </Text>
        ) : (
          <View style={[styles.logsCard, { backgroundColor: colors.surface0, borderRadius: radius.lg, padding: spacing.sm }]}>
            {visibleLogs.map((log, idx) => (
              <View key={`${log.time}-${idx}`} style={styles.logEntry}>
                <Text
                  style={[
                    styles.logTime,
                    { color: colors.textMuted, fontFamily: fonts.mono.regular },
                  ]}
                >
                  {new Date(log.time).toLocaleTimeString()}
                </Text>
                <Text
                  style={[
                    styles.logMessage,
                    { color: colors.textSecondary, fontFamily: fonts.sans.regular },
                  ]}
                  numberOfLines={2}
                >
                  {log.message}
                </Text>
              </View>
            ))}
            {recentLogs.length > COLLAPSED_LOG_COUNT ? (
              <Pressable onPress={() => setLogsExpanded(!logsExpanded)}>
                <Text
                  style={[
                    styles.showMoreText,
                    { color: colors.accent, fontFamily: fonts.sans.medium },
                  ]}
                >
                  {logsExpanded ? 'Show less' : `Show all ${recentLogs.length} logs`}
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}

        {/* Subagents section */}
        {subagents.length > 0 ? (
          <>
            <Pressable onPress={() => setSubagentsExpanded(!subagentsExpanded)}>
              <SectionHeader title={`Subagents (${subagents.length})`} />
            </Pressable>
            {subagentsExpanded ? (
              <View style={[styles.subagentsCard, { backgroundColor: colors.surface0, borderRadius: radius.lg, padding: spacing.sm }]}>
                {subagents.map((agent) => (
                  <View key={agent.id} style={styles.subagentRow}>
                    {agent.parentId ? (
                      <View style={styles.subagentIndent}>
                        <View style={[styles.subagentLine, { borderColor: colors.surface2 }]} />
                      </View>
                    ) : null}
                    <StatusDot status={agent.status as any} size="sm" />
                    <Text
                      style={[
                        styles.subagentName,
                        { color: colors.textPrimary, fontFamily: fonts.sans.regular },
                      ]}
                      numberOfLines={1}
                    >
                      {agent.name}
                    </Text>
                    <Text
                      style={[
                        styles.subagentStatus,
                        { color: colors.textMuted, fontFamily: fonts.sans.regular },
                      ]}
                    >
                      {agent.status}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {/* Session actions sheet */}
      <SessionActions
        session={session}
        visible={actionsVisible}
        onClose={() => setActionsVisible(false)}
      />

      {/* Add tag modal */}
      <ModalSheet
        visible={tagInputVisible}
        onClose={() => setTagInputVisible(false)}
        title="Add Tag"
      >
        <Input
          value={tagInputValue}
          onChangeText={setTagInputValue}
          placeholder="Tag name"
          autoFocus
          onSubmitEditing={handleAddTag}
        />
        <View style={styles.modalButtonRow}>
          <Button variant="ghost" onPress={() => setTagInputVisible(false)}>Cancel</Button>
          <Button onPress={handleAddTag}>Add</Button>
        </View>
      </ModalSheet>

      {/* Toast */}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 4,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    flexShrink: 1,
  },
  spacer: {
    flex: 1,
  },
  overflowButton: {
    padding: 8,
  },
  content: {
    paddingHorizontal: 16,
    gap: 8,
  },
  // Status section
  statusSection: {},
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  statusLabel: {
    fontSize: 18,
  },
  statusButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  // Metadata
  metadataCard: {
    padding: 4,
  },
  workspaceDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  // Tags
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  addTagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 4,
  },
  addTagText: {
    fontSize: 13,
  },
  // Cost
  costCard: {},
  costTotal: {
    fontSize: 28,
    marginBottom: 2,
  },
  costSubtext: {
    fontSize: 13,
    marginBottom: 12,
  },
  tokenBarContainer: {
    gap: 8,
  },
  tokenLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
  },
  modelBreakdown: {
    marginTop: 16,
    gap: 6,
  },
  modelBreakdownTitle: {
    fontSize: 13,
    marginBottom: 4,
  },
  modelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modelName: {
    fontSize: 12,
    flex: 1,
  },
  modelCost: {
    fontSize: 13,
  },
  // Logs
  logsCard: {
    gap: 2,
  },
  logEntry: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  logTime: {
    fontSize: 11,
    minWidth: 70,
  },
  logMessage: {
    fontSize: 12,
    flex: 1,
  },
  showMoreText: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 8,
  },
  mutedText: {
    fontSize: 13,
    paddingVertical: 8,
  },
  // Subagents
  subagentsCard: {
    gap: 4,
  },
  subagentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  subagentIndent: {
    width: 16,
    alignItems: 'center',
  },
  subagentLine: {
    width: 1,
    height: 20,
    borderLeftWidth: 1,
  },
  subagentName: {
    fontSize: 13,
    flex: 1,
  },
  subagentStatus: {
    fontSize: 11,
  },
  modalButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
});
