/**
 * workspaces.tsx - Workspace management screen.
 *
 * Full workspace management with grouped and ungrouped workspace lists,
 * collapsible group sections, reorder mode (move up/down), and CRUD
 * operations via action sheet and create modal. Accessible from the
 * More tab navigation stack.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  withTiming,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import {
  useWorkspaces,
  useGroups,
  useReorderWorkspaces,
} from '@/hooks/useWorkspaces';
import { WorkspaceItem } from '@/components/workspaces/WorkspaceItem';
import { WorkspaceActions } from '@/components/workspaces/WorkspaceActions';
import { NewWorkspaceModal } from '@/components/workspaces/NewWorkspaceModal';
import { SectionHeader, Skeleton, EmptyState, Toast } from '@/components/ui';
import type { Workspace, WorkspaceGroup } from '@/types/api';

/**
 * WorkspacesScreen - Manage workspaces with groups, colors, and reordering.
 *
 * Features:
 * - Grouped workspace sections with collapsible headers
 * - Ungrouped workspace section
 * - Reorder mode with move up/down buttons
 * - Create new workspace modal
 * - Long-press action sheet (rename, color, description, delete)
 * - Pull-to-refresh
 * - Loading skeleton, error, and empty states
 */
export default function WorkspacesScreen() {
  const { theme } = useTheme();
  const { colors, spacing, typography, radius, animation } = theme;
  const router = useRouter();

  // Data queries
  const workspacesQuery = useWorkspaces();
  const groupsQuery = useGroups();
  const reorderMutation = useReorderWorkspaces();

  // UI state
  const [reorderMode, setReorderMode] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [actionsWorkspace, setActionsWorkspace] = useState<Workspace | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // Toast state
  const [toastMessage, setToastMessage] = useState('');
  const [toastVariant, setToastVariant] = useState<'success' | 'error'>('success');
  const [toastVisible, setToastVisible] = useState(false);

  // Derived data
  const workspaces = workspacesQuery.data?.workspaces ?? [];
  const workspaceOrder = workspacesQuery.data?.workspaceOrder ?? [];
  const groups = groupsQuery.data?.groups ?? [];

  /**
   * Build a lookup map from workspace ID to session count.
   * Uses the workspace.sessions array length as the count.
   */
  const sessionCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const ws of workspaces) {
      map[ws.id] = ws.sessions?.length ?? 0;
    }
    return map;
  }, [workspaces]);

  /**
   * Build a set of workspace IDs that belong to any group.
   * Used to determine which workspaces are "ungrouped".
   */
  const groupedWorkspaceIds = useMemo(() => {
    const set = new Set<string>();
    for (const group of groups) {
      for (const id of group.workspaceIds) {
        set.add(id);
      }
    }
    return set;
  }, [groups]);

  /** Workspaces not belonging to any group */
  const ungroupedWorkspaces = useMemo(
    () => workspaces.filter((ws) => !groupedWorkspaceIds.has(ws.id)),
    [workspaces, groupedWorkspaceIds]
  );

  /**
   * Ordered workspaces list for reorder operations.
   * Follows workspaceOrder if available, falls back to array order.
   */
  const orderedWorkspaces = useMemo(() => {
    if (workspaceOrder.length === 0) return workspaces;
    const map = new Map(workspaces.map((ws) => [ws.id, ws]));
    const ordered: Workspace[] = [];
    for (const id of workspaceOrder) {
      const ws = map.get(id);
      if (ws) ordered.push(ws);
    }
    // Append any workspaces not in the order array
    for (const ws of workspaces) {
      if (!workspaceOrder.includes(ws.id)) ordered.push(ws);
    }
    return ordered;
  }, [workspaces, workspaceOrder]);

  /**
   * Show a toast notification.
   * @param message - Toast message text
   * @param variant - success or error
   */
  const showToast = useCallback(
    (message: string, variant: 'success' | 'error') => {
      setToastMessage(message);
      setToastVariant(variant);
      setToastVisible(true);
    },
    []
  );

  /**
   * Toggle collapsed state of a group section.
   * @param groupId - Group ID to toggle
   */
  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  }, []);

  /**
   * Handle workspace tap: navigate to sessions filtered by workspace.
   * @param workspaceId - Workspace to filter by
   */
  const handleWorkspacePress = useCallback(
    (workspaceId: string) => {
      if (reorderMode) return;
      // Navigate to sessions tab with workspace filter
      router.push(`/(tabs)/sessions?workspaceId=${workspaceId}`);
    },
    [router, reorderMode]
  );

  /**
   * Handle workspace long-press: open action sheet.
   * @param workspaceId - Workspace to act on
   */
  const handleWorkspaceLongPress = useCallback(
    (workspaceId: string) => {
      if (reorderMode) return;
      const ws = workspaces.find((w) => w.id === workspaceId);
      if (ws) setActionsWorkspace(ws);
    },
    [workspaces, reorderMode]
  );

  /**
   * Move a workspace up in the order.
   * Swaps with the previous item and sends new order to server.
   * @param workspaceId - Workspace to move up
   */
  const handleMoveUp = useCallback(
    (workspaceId: string) => {
      const ids = orderedWorkspaces.map((ws) => ws.id);
      const idx = ids.indexOf(workspaceId);
      if (idx <= 0) return;
      // Swap with previous
      [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
      reorderMutation.mutate(ids);
    },
    [orderedWorkspaces, reorderMutation]
  );

  /**
   * Move a workspace down in the order.
   * Swaps with the next item and sends new order to server.
   * @param workspaceId - Workspace to move down
   */
  const handleMoveDown = useCallback(
    (workspaceId: string) => {
      const ids = orderedWorkspaces.map((ws) => ws.id);
      const idx = ids.indexOf(workspaceId);
      if (idx < 0 || idx >= ids.length - 1) return;
      // Swap with next
      [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
      reorderMutation.mutate(ids);
    },
    [orderedWorkspaces, reorderMutation]
  );

  /** Pull-to-refresh handler */
  const handleRefresh = useCallback(() => {
    workspacesQuery.refetch();
    groupsQuery.refetch();
  }, [workspacesQuery, groupsQuery]);

  // ─── Styles ──────────────────────────────────────────────

  const containerStyle = useMemo<ViewStyle>(
    () => ({
      flex: 1,
      backgroundColor: colors.base,
    }),
    [colors]
  );

  const headerStyle = useMemo<ViewStyle>(
    () => ({
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSubtle,
    }),
    [spacing, colors]
  );

  const headerTitleStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textPrimary,
      fontFamily: fonts.sans.bold,
      fontSize: typography.sizes.xl,
    }),
    [colors, typography]
  );

  const headerActionsStyle = useMemo<ViewStyle>(
    () => ({
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    }),
    [spacing]
  );

  const headerButtonStyle = useMemo<ViewStyle>(
    () => ({
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.borderDefault,
    }),
    [spacing, radius, colors]
  );

  const reorderActiveStyle = useMemo<ViewStyle>(
    () => ({
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    }),
    [colors]
  );

  const reorderTextStyle = useMemo<TextStyle>(
    () => ({
      fontFamily: fonts.sans.medium,
      fontSize: typography.sizes.sm,
    }),
    [typography]
  );

  const listContentStyle = useMemo<ViewStyle>(
    () => ({
      padding: spacing.md,
      gap: spacing.sm,
      paddingBottom: spacing.xxl,
    }),
    [spacing]
  );

  const groupHeaderStyle = useMemo<ViewStyle>(
    () => ({
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.xs,
    }),
    [spacing]
  );

  const groupNameStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textPrimary,
      fontFamily: fonts.sans.semibold,
      fontSize: typography.sizes.md,
      flex: 1,
    }),
    [colors, typography]
  );

  const groupCountStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textTertiary,
      fontFamily: fonts.sans.regular,
      fontSize: typography.sizes.xs,
    }),
    [colors, typography]
  );

  const groupBorderStyle = useCallback(
    (groupColor: string): ViewStyle => ({
      borderLeftWidth: 3,
      borderLeftColor: groupColor || colors.accent,
      borderRadius: radius.sm,
      paddingLeft: spacing.sm,
      marginBottom: spacing.sm,
    }),
    [colors, radius, spacing]
  );

  // ─── Loading state ─────────────────────────────────────────

  if (workspacesQuery.isLoading) {
    return (
      <SafeAreaView edges={['bottom']} style={containerStyle}>
        <View style={headerStyle}>
          <Text style={headerTitleStyle}>Workspaces</Text>
        </View>
        <View style={listContentStyle}>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width="100%" height={72} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  // ─── Error state ───────────────────────────────────────────

  if (workspacesQuery.isError) {
    return (
      <SafeAreaView edges={['bottom']} style={containerStyle}>
        <View style={headerStyle}>
          <Text style={headerTitleStyle}>Workspaces</Text>
        </View>
        <EmptyState
          icon={
            <Ionicons
              name="alert-circle-outline"
              size={48}
              color={colors.red}
            />
          }
          title="Failed to load workspaces"
          description="Check your connection and try again."
          action={{ label: 'Retry', onPress: handleRefresh }}
        />
      </SafeAreaView>
    );
  }

  // ─── Empty state ───────────────────────────────────────────

  if (workspaces.length === 0) {
    return (
      <SafeAreaView edges={['bottom']} style={containerStyle}>
        <View style={headerStyle}>
          <Text style={headerTitleStyle}>Workspaces</Text>
          <Pressable
            onPress={() => setCreateModalVisible(true)}
            hitSlop={8}
          >
            <Ionicons name="add-circle" size={28} color={colors.accent} />
          </Pressable>
        </View>
        <EmptyState
          icon={
            <Ionicons
              name="folder-open-outline"
              size={48}
              color={colors.textMuted}
            />
          }
          title="No workspaces"
          description="Create your first workspace to organize sessions."
          action={{
            label: 'Create Workspace',
            onPress: () => setCreateModalVisible(true),
          }}
        />
        <NewWorkspaceModal
          visible={createModalVisible}
          onClose={() => setCreateModalVisible(false)}
          onToast={showToast}
        />
        <Toast
          message={toastMessage}
          variant={toastVariant}
          visible={toastVisible}
          onDismiss={() => setToastVisible(false)}
        />
      </SafeAreaView>
    );
  }

  // ─── Render grouped workspace section ──────────────────────

  /**
   * Renders a collapsible group section with its workspaces.
   * @param group - The workspace group to render
   */
  const renderGroup = (group: WorkspaceGroup) => {
    const isCollapsed = collapsedGroups[group.id] ?? false;
    const groupWorkspaces = group.workspaceIds
      .map((id) => workspaces.find((ws) => ws.id === id))
      .filter(Boolean) as Workspace[];

    return (
      <View key={group.id} style={groupBorderStyle(group.color)}>
        {/* Group header: tap to toggle */}
        <Pressable onPress={() => toggleGroup(group.id)}>
          <View style={groupHeaderStyle}>
            <Ionicons
              name={isCollapsed ? 'chevron-forward' : 'chevron-down'}
              size={16}
              color={colors.textSecondary}
            />
            <Text style={groupNameStyle}>{group.name}</Text>
            <Text style={groupCountStyle}>
              {groupWorkspaces.length}
            </Text>
          </View>
        </Pressable>

        {/* Group children: animated show/hide */}
        {!isCollapsed && (
          <Animated.View
            entering={FadeIn.duration(animation.fast)}
            exiting={FadeOut.duration(animation.fast)}
            style={{ gap: spacing.sm }}
          >
            {groupWorkspaces.map((ws) => (
              <WorkspaceItem
                key={ws.id}
                workspace={ws}
                sessionCount={sessionCounts[ws.id] ?? 0}
                onPress={handleWorkspacePress}
                onLongPress={handleWorkspaceLongPress}
                reorderMode={reorderMode}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
              />
            ))}
          </Animated.View>
        )}
      </View>
    );
  };

  // ─── Main content ──────────────────────────────────────────

  return (
    <SafeAreaView edges={['bottom']} style={containerStyle}>
      {/* Header with title, reorder toggle, and create button */}
      <View style={headerStyle}>
        <Text style={headerTitleStyle}>Workspaces</Text>
        <View style={headerActionsStyle}>
          {/* Reorder toggle button */}
          <Pressable
            onPress={() => setReorderMode((prev) => !prev)}
            style={[
              headerButtonStyle,
              reorderMode ? reorderActiveStyle : null,
            ]}
          >
            <Text
              style={[
                reorderTextStyle,
                {
                  color: reorderMode ? colors.crust : colors.textSecondary,
                },
              ]}
            >
              {reorderMode ? 'Done' : 'Reorder'}
            </Text>
          </Pressable>

          {/* Create workspace button */}
          <Pressable
            onPress={() => setCreateModalVisible(true)}
            hitSlop={8}
          >
            <Ionicons name="add-circle" size={28} color={colors.accent} />
          </Pressable>
        </View>
      </View>

      {/* Workspace list with pull-to-refresh */}
      <ScrollView
        contentContainerStyle={listContentStyle}
        refreshControl={
          <RefreshControl
            refreshing={workspacesQuery.isFetching}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
      >
        {/* Grouped sections */}
        {groups.length > 0 && groups.map(renderGroup)}

        {/* Ungrouped workspaces */}
        {ungroupedWorkspaces.length > 0 && (
          <>
            {groups.length > 0 && (
              <SectionHeader title="Ungrouped" />
            )}
            {(reorderMode ? orderedWorkspaces.filter(
              (ws) => !groupedWorkspaceIds.has(ws.id)
            ) : ungroupedWorkspaces).map((ws) => (
              <WorkspaceItem
                key={ws.id}
                workspace={ws}
                sessionCount={sessionCounts[ws.id] ?? 0}
                onPress={handleWorkspacePress}
                onLongPress={handleWorkspaceLongPress}
                reorderMode={reorderMode}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
              />
            ))}
          </>
        )}
      </ScrollView>

      {/* Action sheet for selected workspace */}
      {actionsWorkspace && (
        <WorkspaceActions
          workspace={actionsWorkspace}
          visible={!!actionsWorkspace}
          onClose={() => setActionsWorkspace(null)}
          onToast={showToast}
        />
      )}

      {/* Create workspace modal */}
      <NewWorkspaceModal
        visible={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        onToast={showToast}
      />

      {/* Toast notifications */}
      <Toast
        message={toastMessage}
        variant={toastVariant}
        visible={toastVisible}
        onDismiss={() => setToastVisible(false)}
      />
    </SafeAreaView>
  );
}
