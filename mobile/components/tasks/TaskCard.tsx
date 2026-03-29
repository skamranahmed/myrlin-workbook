/**
 * TaskCard.tsx - Card component for a single worktree task.
 *
 * Displays task description, branch name, model, changed files,
 * commits ahead, tags, PR badge, and blocked indicator. Tappable
 * to navigate to detail. Long-press opens an ActionSheet with
 * quick actions (blocker, model, tags, status, delete).
 */

import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import {
  Badge,
  Chip,
  StatusDot,
  ActionSheet,
  type ActionSheetAction,
} from '@/components/ui';
import type { WorktreeTask, TaskStatus } from '@/types/api';
import { useUpdateTask, useDeleteTask } from '@/hooks/useTasks';

/** Map task status to StatusDot color key */
const STATUS_COLOR_MAP: Record<TaskStatus, string> = {
  backlog: 'overlay0',
  planning: 'blue',
  running: 'green',
  review: 'yellow',
  done: 'green',
};

/** Ordered list of all statuses for the "Move to" submenu */
const ALL_STATUSES: TaskStatus[] = ['backlog', 'planning', 'running', 'review', 'done'];

interface TaskCardProps {
  /** The task to display */
  task: WorktreeTask;
}

/**
 * TaskCard - Pressable card rendering a single worktree task.
 *
 * Shows description (2-line clamp), branch (mono), model chip,
 * file count, commits ahead, tags, PR badge, and blocked badge.
 *
 * @param props.task - WorktreeTask data
 */
export function TaskCard({ task }: TaskCardProps) {
  const { theme } = useTheme();
  const router = useRouter();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const [sheetVisible, setSheetVisible] = useState(false);

  /** Navigate to task detail */
  const handlePress = useCallback(() => {
    router.push(`/tasks/${task.id}` as any);
  }, [task.id, router]);

  /** Show long-press action sheet */
  const handleLongPress = useCallback(() => {
    setSheetVisible(true);
  }, []);

  /** Build action sheet items */
  const actions: ActionSheetAction[] = [
    ...ALL_STATUSES
      .filter((s) => s !== task.status)
      .map((s) => ({
        label: `Move to ${s.charAt(0).toUpperCase() + s.slice(1)}`,
        onPress: () => updateTask.mutate({ id: task.id, data: { status: s } }),
      })),
    {
      label: 'Delete Task',
      onPress: () => deleteTask.mutate(task.id),
      destructive: true as const,
    },
  ];

  /** Resolve status color from theme */
  const statusColorKey = STATUS_COLOR_MAP[task.status] as keyof typeof theme.colors;
  const statusColor = theme.colors[statusColorKey] || theme.colors.overlay0;

  return (
    <>
      <Pressable
        onPress={handlePress}
        onLongPress={handleLongPress}
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface0,
            borderColor: theme.colors.borderSubtle,
          },
        ]}
      >
        {/* Header row: status dot + description */}
        <View style={styles.headerRow}>
          <StatusDot status={task.status === 'running' ? 'running' : 'stopped'} size="sm" />
          <Text
            numberOfLines={2}
            style={[
              styles.description,
              {
                color: theme.colors.textPrimary,
                fontFamily: fonts.sans.semibold,
              },
            ]}
          >
            {task.description}
          </Text>
        </View>

        {/* Branch name */}
        <Text
          numberOfLines={1}
          style={[
            styles.branch,
            {
              color: theme.colors.textSecondary,
              fontFamily: fonts.mono.regular,
            },
          ]}
        >
          {task.branch}
        </Text>

        {/* Metadata row: model, files, commits */}
        <View style={styles.metaRow}>
          {task.model && (
            <Chip label={task.model} />
          )}
          {task.changedFiles > 0 && (
            <Badge variant="default">
              {`${task.changedFiles} files`}
            </Badge>
          )}
          {task.branchAhead > 0 && (
            <Badge variant="default">
              {`${task.branchAhead} ahead`}
            </Badge>
          )}
        </View>

        {/* Tags row */}
        {task.tags.length > 0 && (
          <View style={styles.tagsRow}>
            {task.tags.map((tag) => (
              <Chip key={tag} label={tag} />
            ))}
          </View>
        )}

        {/* Badges row: PR, blocked */}
        <View style={styles.badgesRow}>
          {task.blockers.length > 0 && (
            <Badge variant="error">Blocked</Badge>
          )}
        </View>
      </Pressable>

      <ActionSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        actions={actions}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  description: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  branch: {
    fontSize: 12,
    lineHeight: 16,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  badgesRow: {
    flexDirection: 'row',
    gap: 6,
  },
});
