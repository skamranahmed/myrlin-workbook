/**
 * SessionActions.tsx - Action sheet for session lifecycle operations.
 *
 * Presents a context menu with start/stop/restart, rename, move, AI features
 * (auto-title, summarize), save-as-template, and delete actions. Actions are
 * conditionally shown based on the session's current status.
 *
 * Uses mutation hooks for standard CRUD and the API client directly for
 * AI endpoints (autoTitle, summarize, createTemplate).
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Alert, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { useAPIClient } from '@/hooks/useAPIClient';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import {
  useStartSession,
  useStopSession,
  useRestartSession,
  useDeleteSession,
  useUpdateSession,
} from '@/hooks/useSessions';
import {
  ActionSheet,
  ModalSheet,
  Input,
  Chip,
  Button,
  Toast,
  type ActionSheetAction,
} from '@/components/ui';
import { fonts } from '@/theme/fonts';
import type { Session } from '@/types/api';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

export interface SessionActionsProps {
  /** The session to operate on */
  session: Session;
  /** Whether the action sheet is visible */
  visible: boolean;
  /** Called when the sheet should close */
  onClose: () => void;
  /** Optional callback for workspace picker navigation */
  onNavigateToWorkspaces?: () => void;
}

/**
 * SessionActions - Contextual action sheet for session operations.
 *
 * Handles all session lifecycle actions: start, stop, restart, rename,
 * move to workspace, auto-title (AI), summarize (AI), save as template,
 * and delete. Each action shows a toast on success or error.
 *
 * @param props - Session and visibility controls
 */
export function SessionActions({
  session,
  visible,
  onClose,
  onNavigateToWorkspaces,
}: SessionActionsProps) {
  const { theme } = useTheme();
  const router = useRouter();
  const client = useAPIClient();
  const queryClient = useQueryClient();

  // Mutations
  const startMutation = useStartSession();
  const stopMutation = useStopSession();
  const restartMutation = useRestartSession();
  const deleteMutation = useDeleteSession();
  const updateMutation = useUpdateSession();

  // Workspace data for move action
  const workspacesQuery = useWorkspaces();
  const workspaces = workspacesQuery.data?.workspaces ?? [];

  // Sub-modal state
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [moveVisible, setMoveVisible] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVariant, setToastVariant] = useState<'success' | 'error'>('success');

  /**
   * Show a toast notification with the given message and variant.
   * @param message - Toast text
   * @param variant - success or error
   */
  const showToast = useCallback((message: string, variant: 'success' | 'error') => {
    setToastMessage(message);
    setToastVariant(variant);
    setToastVisible(true);
  }, []);

  /**
   * Start the session and show result toast.
   */
  const handleStart = useCallback(() => {
    onClose();
    startMutation.mutate(session.id, {
      onSuccess: () => showToast('Session started', 'success'),
      onError: () => showToast('Failed to start session', 'error'),
    });
  }, [session.id, startMutation, onClose, showToast]);

  /**
   * Stop the session and show result toast.
   */
  const handleStop = useCallback(() => {
    onClose();
    stopMutation.mutate(session.id, {
      onSuccess: () => showToast('Session stopped', 'success'),
      onError: () => showToast('Failed to stop session', 'error'),
    });
  }, [session.id, stopMutation, onClose, showToast]);

  /**
   * Restart the session and show result toast.
   */
  const handleRestart = useCallback(() => {
    onClose();
    restartMutation.mutate(session.id, {
      onSuccess: () => showToast('Session restarted', 'success'),
      onError: () => showToast('Failed to restart session', 'error'),
    });
  }, [session.id, restartMutation, onClose, showToast]);

  /**
   * Open the rename modal pre-filled with the current name.
   */
  const handleRenameOpen = useCallback(() => {
    onClose();
    setRenameValue(session.name);
    setRenameVisible(true);
  }, [session.name, onClose]);

  /**
   * Submit the rename and update the session.
   */
  const handleRenameSubmit = useCallback(() => {
    if (!renameValue.trim()) return;
    setRenameVisible(false);
    updateMutation.mutate(
      { id: session.id, data: { name: renameValue.trim() } },
      {
        onSuccess: () => showToast('Session renamed', 'success'),
        onError: () => showToast('Failed to rename session', 'error'),
      }
    );
  }, [session.id, renameValue, updateMutation, showToast]);

  /**
   * Open the workspace picker modal.
   */
  const handleMoveOpen = useCallback(() => {
    onClose();
    setMoveVisible(true);
  }, [onClose]);

  /**
   * Move the session to a different workspace.
   * @param workspaceId - Target workspace ID
   */
  const handleMoveToWorkspace = useCallback(
    (workspaceId: string) => {
      setMoveVisible(false);
      updateMutation.mutate(
        { id: session.id, data: { workspaceId } },
        {
          onSuccess: () => showToast('Session moved', 'success'),
          onError: () => showToast('Failed to move session', 'error'),
        }
      );
    },
    [session.id, updateMutation, showToast]
  );

  /**
   * Generate an AI title for the session.
   */
  const handleAutoTitle = useCallback(async () => {
    onClose();
    if (!client) return;
    try {
      const result = await client.autoTitle(session.id);
      queryClient.invalidateQueries({ queryKey: ['session', session.id] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      showToast(`Titled: ${result.title}`, 'success');
    } catch {
      showToast('Failed to auto-title session', 'error');
    }
  }, [session.id, client, queryClient, onClose, showToast]);

  /**
   * Generate an AI summary for the session.
   */
  const handleSummarize = useCallback(async () => {
    onClose();
    if (!client) return;
    try {
      const result = await client.summarize(session.id);
      Alert.alert('Session Summary', result.summary);
    } catch {
      showToast('Failed to summarize session', 'error');
    }
  }, [session.id, client, onClose, showToast]);

  /**
   * Save the session configuration as a reusable template.
   */
  const handleSaveAsTemplate = useCallback(async () => {
    onClose();
    if (!client) return;
    try {
      await client.createTemplate({
        name: `${session.name} Template`,
        command: session.command,
        workingDir: session.workingDir,
        model: '',
        bypassPermissions: false,
        verbose: false,
        agentTeams: false,
      });
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      showToast('Template saved', 'success');
    } catch {
      showToast('Failed to save template', 'error');
    }
  }, [session, client, queryClient, onClose, showToast]);

  /**
   * Delete the session with a confirmation dialog.
   */
  const handleDelete = useCallback(() => {
    onClose();
    Alert.alert(
      'Delete Session',
      `Are you sure you want to delete "${session.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteMutation.mutate(session.id, {
              onSuccess: () => {
                showToast('Session deleted', 'success');
                router.back();
              },
              onError: () => showToast('Failed to delete session', 'error'),
            });
          },
        },
      ]
    );
  }, [session.id, session.name, deleteMutation, onClose, showToast, router]);

  // Build action list based on session status
  const actions = useMemo<ActionSheetAction[]>(() => {
    const list: ActionSheetAction[] = [];

    if (session.status === 'stopped' || session.status === 'error' || session.status === 'idle') {
      list.push({ label: 'Start', onPress: handleStart });
    }
    if (session.status === 'running') {
      list.push({ label: 'Stop', onPress: handleStop });
      list.push({ label: 'Restart', onPress: handleRestart });
    }

    list.push({ label: 'Rename', onPress: handleRenameOpen });
    list.push({ label: 'Move to Workspace', onPress: handleMoveOpen });
    list.push({ label: 'Auto-title (AI)', onPress: handleAutoTitle });
    list.push({ label: 'Summarize (AI)', onPress: handleSummarize });
    list.push({ label: 'Save as Template', onPress: handleSaveAsTemplate });
    list.push({ label: 'Delete', destructive: true, onPress: handleDelete });

    return list;
  }, [
    session.status,
    handleStart,
    handleStop,
    handleRestart,
    handleRenameOpen,
    handleMoveOpen,
    handleAutoTitle,
    handleSummarize,
    handleSaveAsTemplate,
    handleDelete,
  ]);

  return (
    <>
      {/* Main action sheet */}
      <ActionSheet visible={visible} onClose={onClose} actions={actions} />

      {/* Rename modal */}
      <ModalSheet
        visible={renameVisible}
        onClose={() => setRenameVisible(false)}
        title="Rename Session"
      >
        <Input
          value={renameValue}
          onChangeText={setRenameValue}
          placeholder="Session name"
          autoFocus
          onSubmitEditing={handleRenameSubmit}
        />
        <View style={styles.modalButtonRow}>
          <Button variant="ghost" onPress={() => setRenameVisible(false)}>
            Cancel
          </Button>
          <Button onPress={handleRenameSubmit}>Rename</Button>
        </View>
      </ModalSheet>

      {/* Move to workspace modal */}
      <ModalSheet
        visible={moveVisible}
        onClose={() => setMoveVisible(false)}
        title="Move to Workspace"
      >
        <ScrollView style={styles.workspaceList}>
          {workspaces.map((ws) => (
            <Pressable
              key={ws.id}
              onPress={() => handleMoveToWorkspace(ws.id)}
              style={[
                styles.workspaceRow,
                {
                  backgroundColor:
                    ws.id === session.workspaceId
                      ? theme.colors.surface1
                      : 'transparent',
                  borderRadius: theme.radius.md,
                },
              ]}
            >
              <View
                style={[
                  styles.workspaceColorDot,
                  { backgroundColor: ws.color || theme.colors.accent },
                ]}
              />
              <Text
                style={[
                  styles.workspaceName,
                  {
                    color: theme.colors.textPrimary,
                    fontFamily: fonts.sans.medium,
                  },
                ]}
              >
                {ws.name}
              </Text>
              {ws.id === session.workspaceId ? (
                <Text
                  style={[
                    styles.currentLabel,
                    {
                      color: theme.colors.textMuted,
                      fontFamily: fonts.sans.regular,
                    },
                  ]}
                >
                  Current
                </Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      </ModalSheet>

      {/* Toast notification */}
      <Toast
        visible={toastVisible}
        message={toastMessage}
        variant={toastVariant}
        onDismiss={() => setToastVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  modalButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
  workspaceList: {
    maxHeight: 300,
  },
  workspaceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  workspaceColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  workspaceName: {
    fontSize: 15,
    flex: 1,
  },
  currentLabel: {
    fontSize: 12,
  },
});
