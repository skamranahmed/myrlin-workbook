/**
 * CreateTaskSheet.tsx - ModalSheet for creating a new worktree task.
 *
 * Provides input fields for description, branch name (auto-generated
 * from description as suggestion), repo directory, model, tags, and
 * base branch. A toggle controls whether to start immediately or add
 * to backlog.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { Button, Input, ModalSheet, Toggle } from '@/components/ui';
import { useCreateTask } from '@/hooks/useTasks';

interface CreateTaskSheetProps {
  /** Whether the sheet is visible */
  visible: boolean;
  /** Called when the sheet should close */
  onClose: () => void;
  /** Optional pre-filled workspace ID */
  workspaceId?: string;
}

/**
 * Slugify a description string into a valid git branch name.
 * Lowercases, replaces spaces/special chars with hyphens, trims.
 *
 * @param text - Description to convert
 * @returns Branch-friendly string
 */
function toBranchName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/**
 * CreateTaskSheet - Bottom sheet form for creating a new worktree task.
 *
 * @param props - Sheet visibility and close handler
 */
export function CreateTaskSheet({
  visible,
  onClose,
  workspaceId,
}: CreateTaskSheetProps) {
  const { theme } = useTheme();
  const createTask = useCreateTask();

  const [description, setDescription] = useState('');
  const [branch, setBranch] = useState('');
  const [repoDir, setRepoDir] = useState('');
  const [model, setModel] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [startNow, setStartNow] = useState(true);
  const [branchEdited, setBranchEdited] = useState(false);

  /** Auto-generate branch name from description when not manually edited */
  useEffect(() => {
    if (!branchEdited && description) {
      setBranch(`feat/${toBranchName(description)}`);
    }
  }, [description, branchEdited]);

  /** Reset form state when sheet opens */
  useEffect(() => {
    if (visible) {
      setDescription('');
      setBranch('');
      setRepoDir('');
      setModel('');
      setTagsText('');
      setBaseBranch('main');
      setStartNow(true);
      setBranchEdited(false);
    }
  }, [visible]);

  /** Handle manual branch name edits */
  const handleBranchChange = useCallback((text: string) => {
    setBranch(text);
    setBranchEdited(true);
  }, []);

  /** Submit the form */
  const handleCreate = useCallback(() => {
    if (!description.trim() || !branch.trim()) return;

    const tags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    createTask.mutate(
      {
        workspaceId: workspaceId || '',
        repoDir: repoDir.trim(),
        branch: branch.trim(),
        description: description.trim(),
        baseBranch: baseBranch.trim() || 'main',
        model: model.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        startNow,
      },
      {
        onSuccess: () => onClose(),
      }
    );
  }, [
    description,
    branch,
    repoDir,
    model,
    tagsText,
    baseBranch,
    startNow,
    workspaceId,
    createTask,
    onClose,
  ]);

  return (
    <ModalSheet visible={visible} onClose={onClose} title="New Task">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Input
          label="Description"
          placeholder="What needs to be done?"
          value={description}
          onChangeText={setDescription}
          multiline
        />

        <Input
          label="Branch"
          placeholder="feat/my-feature"
          value={branch}
          onChangeText={handleBranchChange}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Input
          label="Repo Directory"
          placeholder="/path/to/repo"
          value={repoDir}
          onChangeText={setRepoDir}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Input
          label="Base Branch"
          placeholder="main"
          value={baseBranch}
          onChangeText={setBaseBranch}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Input
          label="Model (optional)"
          placeholder="claude-sonnet-4-5"
          value={model}
          onChangeText={setModel}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Input
          label="Tags (comma-separated)"
          placeholder="ui, bugfix, backend"
          value={tagsText}
          onChangeText={setTagsText}
        />

        <Toggle
          label="Start immediately"
          description="Create worktree and launch session now"
          value={startNow}
          onValueChange={setStartNow}
        />

        <View style={styles.buttonRow}>
          <Button
            onPress={handleCreate}
            variant="primary"
            loading={createTask.isPending}
            disabled={!description.trim() || !branch.trim()}
          >
            Create Task
          </Button>
        </View>
      </ScrollView>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  scroll: {
    maxHeight: 480,
  },
  content: {
    gap: 12,
    paddingBottom: 24,
  },
  buttonRow: {
    marginTop: 8,
  },
});
