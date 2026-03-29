/**
 * TaskDetail.tsx - Full detail view for a single worktree task.
 *
 * Displays task metadata (description, status, branch, workspace, model,
 * dates), editable tags, blockers, changed files, PR status with create
 * and generate actions, merge/push/reject buttons, and an AI spinoff
 * button for extracting tasks from sessions.
 */

import React, { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import {
  ActionSheet,
  Badge,
  Button,
  Card,
  Chip,
  Input,
  SectionHeader,
  type ActionSheetAction,
} from '@/components/ui';
import type { WorktreeTask } from '@/types/api';
import {
  useUpdateTask,
  useTaskPR,
  useTaskChanges,
  useCreatePR,
  useMergeTask,
  usePushTask,
  useRejectTask,
} from '@/hooks/useTasks';

interface TaskDetailProps {
  /** The task to display */
  task: WorktreeTask;
}

/**
 * TaskDetail - Comprehensive detail view for a worktree task.
 *
 * Sections: header, metadata, tags, blockers, changes, PR, actions, AI spinoff.
 *
 * @param props.task - WorktreeTask data
 */
export function TaskDetail({ task }: TaskDetailProps) {
  const { theme } = useTheme();
  const updateTask = useUpdateTask();
  const createPR = useCreatePR();
  const mergeTask = useMergeTask();
  const pushTask = usePushTask();
  const rejectTask = useRejectTask();

  const { data: prData } = useTaskPR(task.id);
  const { data: changesData } = useTaskChanges(task.id);

  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [newBlocker, setNewBlocker] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const [showBlockerInput, setShowBlockerInput] = useState(false);

  /** Add a new tag to the task */
  const handleAddTag = useCallback(() => {
    const tag = newTag.trim();
    if (!tag) return;
    updateTask.mutate({
      id: task.id,
      data: { tags: [...task.tags, tag] },
    });
    setNewTag('');
    setShowTagInput(false);
  }, [newTag, task.id, task.tags, updateTask]);

  /** Remove a tag by index */
  const handleRemoveTag = useCallback(
    (index: number) => {
      const next = task.tags.filter((_, i) => i !== index);
      updateTask.mutate({ id: task.id, data: { tags: next } });
    },
    [task.id, task.tags, updateTask]
  );

  /** Add a new blocker */
  const handleAddBlocker = useCallback(() => {
    const text = newBlocker.trim();
    if (!text) return;
    updateTask.mutate({
      id: task.id,
      data: { blockers: [...task.blockers, text] },
    });
    setNewBlocker('');
    setShowBlockerInput(false);
  }, [newBlocker, task.id, task.blockers, updateTask]);

  /** Remove a blocker by index */
  const handleRemoveBlocker = useCallback(
    (index: number) => {
      const next = task.blockers.filter((_, i) => i !== index);
      updateTask.mutate({ id: task.id, data: { blockers: next } });
    },
    [task.id, task.blockers, updateTask]
  );

  /** Confirm before merge/reject */
  const confirmAction = useCallback(
    (label: string, action: () => void) => {
      Alert.alert(
        `${label} Task`,
        `Are you sure you want to ${label.toLowerCase()} this task branch?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: label, onPress: action, style: label === 'Reject' ? 'destructive' : 'default' },
        ]
      );
    },
    []
  );

  /** Format ISO date to short display */
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const pr = prData?.pr ?? null;
  const changes = changesData ?? null;

  /** Action sheet for AI spinoff */
  const spinoffActions: ActionSheetAction[] = [
    {
      label: 'Extract tasks from session (AI)',
      onPress: () => {
        Alert.alert(
          'AI Spinoff',
          'This will analyze the linked session and extract actionable tasks. The server handles AI extraction.',
          [{ text: 'OK' }]
        );
      },
    },
  ];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.base }]}
      contentContainerStyle={styles.content}
    >
      {/* Header */}
      <View style={styles.header}>
        <Badge variant={task.status === 'done' ? 'success' : 'default'}>
          {task.status.charAt(0).toUpperCase() + task.status.slice(1)}
        </Badge>
        <Text
          style={[
            styles.title,
            { color: theme.colors.textPrimary, fontFamily: fonts.sans.bold },
          ]}
        >
          {task.description}
        </Text>
        <Text
          style={[
            styles.branch,
            { color: theme.colors.textSecondary, fontFamily: fonts.mono.regular },
          ]}
        >
          {task.branch}
        </Text>
      </View>

      {/* Metadata */}
      <Card>
        <View style={styles.metaGrid}>
          <MetaItem label="Base Branch" value={task.baseBranch} theme={theme} />
          <MetaItem label="Model" value={task.model || 'None'} theme={theme} />
          <MetaItem label="Created" value={formatDate(task.createdAt)} theme={theme} />
          <MetaItem label="Updated" value={formatDate(task.updatedAt)} theme={theme} />
          <MetaItem label="Commits Ahead" value={String(task.branchAhead)} theme={theme} />
          <MetaItem label="Changed Files" value={String(task.changedFiles)} theme={theme} />
        </View>
      </Card>

      {/* Tags */}
      <SectionHeader title="Tags" />
      <View style={styles.chipsRow}>
        {task.tags.map((tag, i) => (
          <Pressable key={`${tag}-${i}`} onLongPress={() => handleRemoveTag(i)}>
            <Chip label={tag} />
          </Pressable>
        ))}
        {showTagInput ? (
          <View style={styles.inlineInput}>
            <Input
              placeholder="Tag name"
              value={newTag}
              onChangeText={setNewTag}
              onSubmitEditing={handleAddTag}
              autoFocus
            />
          </View>
        ) : (
          <Pressable onPress={() => setShowTagInput(true)}>
            <Chip label="+" />
          </Pressable>
        )}
      </View>

      {/* Blockers */}
      <SectionHeader title="Blockers" />
      {task.blockers.length === 0 && !showBlockerInput && (
        <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>
          No blockers
        </Text>
      )}
      {task.blockers.map((blocker, i) => (
        <View key={`blocker-${i}`} style={styles.blockerRow}>
          <Ionicons name="alert-circle" size={16} color={theme.colors.red} />
          <Text
            style={[
              styles.blockerText,
              { color: theme.colors.textPrimary, fontFamily: fonts.sans.regular },
            ]}
          >
            {blocker}
          </Text>
          <Pressable onPress={() => handleRemoveBlocker(i)}>
            <Ionicons name="close-circle" size={18} color={theme.colors.textTertiary} />
          </Pressable>
        </View>
      ))}
      {showBlockerInput ? (
        <View style={styles.blockerInput}>
          <Input
            placeholder="Describe the blocker"
            value={newBlocker}
            onChangeText={setNewBlocker}
            onSubmitEditing={handleAddBlocker}
            autoFocus
          />
        </View>
      ) : (
        <Pressable onPress={() => setShowBlockerInput(true)} style={styles.addButton}>
          <Text style={[styles.addButtonText, { color: theme.colors.accent }]}>
            + Add Blocker
          </Text>
        </Pressable>
      )}

      {/* Changes */}
      <SectionHeader title="Changes" />
      {changes ? (
        <Card>
          <View style={styles.statsRow}>
            <Text style={[styles.statGreen, { color: theme.colors.green }]}>
              +{changes.stats.additions}
            </Text>
            <Text style={[styles.statRed, { color: theme.colors.red }]}>
              -{changes.stats.deletions}
            </Text>
            <Text style={[styles.statTotal, { color: theme.colors.textSecondary }]}>
              {changes.stats.total} total
            </Text>
          </View>
          {changes.files.map((file) => (
            <Text
              key={file}
              numberOfLines={1}
              style={[
                styles.fileName,
                { color: theme.colors.textSecondary, fontFamily: fonts.mono.regular },
              ]}
            >
              {file}
            </Text>
          ))}
        </Card>
      ) : (
        <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>
          Loading changes...
        </Text>
      )}

      {/* PR Section */}
      <SectionHeader title="Pull Request" />
      {pr ? (
        <Card>
          <Badge variant={pr.merged ? 'success' : 'default'}>
            {pr.merged ? 'Merged' : pr.state || 'Open'}
          </Badge>
          <Text
            style={[
              styles.prTitle,
              { color: theme.colors.textPrimary, fontFamily: fonts.sans.medium },
            ]}
          >
            #{pr.number} {pr.title}
          </Text>
          <Text
            style={[
              styles.prUrl,
              { color: theme.colors.blue, fontFamily: fonts.mono.regular },
            ]}
          >
            {pr.url}
          </Text>
        </Card>
      ) : (
        <View style={styles.prActions}>
          <Button
            onPress={() => createPR.mutate(task.id)}
            variant="primary"
            loading={createPR.isPending}
          >
            Create PR
          </Button>
        </View>
      )}

      {/* Actions */}
      <SectionHeader title="Actions" />
      <View style={styles.actionRow}>
        <Button
          onPress={() => pushTask.mutate(task.id)}
          variant="ghost"
          loading={pushTask.isPending}
        >
          Push
        </Button>
        <Button
          onPress={() => confirmAction('Merge', () => mergeTask.mutate(task.id))}
          variant="primary"
          loading={mergeTask.isPending}
        >
          Merge
        </Button>
        <Button
          onPress={() => confirmAction('Reject', () => rejectTask.mutate(task.id))}
          variant="danger"
          loading={rejectTask.isPending}
        >
          Reject
        </Button>
      </View>

      {/* AI Spinoff */}
      <SectionHeader title="AI Spinoff" />
      <Pressable
        onPress={() => setActionSheetVisible(true)}
        style={[styles.spinoffButton, { borderColor: theme.colors.borderDefault }]}
      >
        <Ionicons name="sparkles" size={20} color={theme.colors.accent} />
        <Text
          style={[
            styles.spinoffText,
            { color: theme.colors.textPrimary, fontFamily: fonts.sans.medium },
          ]}
        >
          Extract from Session
        </Text>
      </Pressable>

      <ActionSheet
        visible={actionSheetVisible}
        onClose={() => setActionSheetVisible(false)}
        actions={spinoffActions}
      />
    </ScrollView>
  );
}

/**
 * MetaItem - Small label/value pair for the metadata grid.
 */
function MetaItem({
  label,
  value,
  theme,
}: {
  label: string;
  value: string;
  theme: any;
}) {
  return (
    <View style={metaStyles.item}>
      <Text
        style={[
          metaStyles.label,
          { color: theme.colors.textTertiary, fontFamily: fonts.sans.regular },
        ]}
      >
        {label}
      </Text>
      <Text
        numberOfLines={1}
        style={[
          metaStyles.value,
          { color: theme.colors.textPrimary, fontFamily: fonts.sans.medium },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const metaStyles = StyleSheet.create({
  item: {
    width: '48%',
    marginBottom: 8,
  },
  label: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  value: {
    fontSize: 14,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 8,
  },
  header: {
    gap: 6,
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
  },
  branch: {
    fontSize: 13,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  inlineInput: {
    minWidth: 120,
  },
  emptyText: {
    fontSize: 13,
    marginBottom: 8,
  },
  blockerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  blockerText: {
    flex: 1,
    fontSize: 14,
  },
  blockerInput: {
    marginTop: 4,
  },
  addButton: {
    paddingVertical: 6,
  },
  addButtonText: {
    fontSize: 14,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  statGreen: {
    fontSize: 14,
    fontFamily: fonts.mono.medium,
  },
  statRed: {
    fontSize: 14,
    fontFamily: fonts.mono.medium,
  },
  statTotal: {
    fontSize: 14,
    fontFamily: fonts.mono.regular,
  },
  fileName: {
    fontSize: 12,
    lineHeight: 20,
  },
  prTitle: {
    fontSize: 15,
    marginTop: 4,
  },
  prUrl: {
    fontSize: 12,
    marginTop: 2,
  },
  prActions: {
    marginBottom: 8,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  spinoffButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 16,
  },
  spinoffText: {
    fontSize: 15,
  },
});
