/**
 * NewSessionModal.tsx - Bottom sheet form for creating a new session.
 *
 * Presents a ModalSheet with fields for name, workspace picker (chip list),
 * working directory (with browse button), command, model, template chips,
 * and initial prompt. Selecting a template pre-fills command, workingDir,
 * and model from the template data.
 *
 * Uses useCreateSession mutation to submit the form and invalidate caches
 * on success.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { useTheme } from '@/hooks/useTheme';
import { useAPIClient } from '@/hooks/useAPIClient';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { useCreateSession } from '@/hooks/useSessions';
import {
  ModalSheet,
  Input,
  Chip,
  Button,
  Toast,
  SectionHeader,
} from '@/components/ui';
import { fonts } from '@/theme/fonts';
import type { SessionTemplate } from '@/types/api';

export interface NewSessionModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** Called when the modal should close */
  onClose: () => void;
  /** Pre-selected workspace ID for the new session */
  defaultWorkspaceId?: string;
}

/**
 * NewSessionModal - Form to create a new session with template support.
 *
 * Layout (top to bottom):
 *   1. Name input (required)
 *   2. Workspace picker (horizontal chip list)
 *   3. Working directory input
 *   4. Command input (defaults to "claude")
 *   5. Model input (optional)
 *   6. Template chips (pre-fill fields on tap)
 *   7. Initial prompt (multiline, optional)
 *   8. Create button
 *
 * @param props - Modal visibility and configuration
 */
export function NewSessionModal({
  visible,
  onClose,
  defaultWorkspaceId,
}: NewSessionModalProps) {
  const { theme } = useTheme();
  const client = useAPIClient();
  const createMutation = useCreateSession();
  const workspacesQuery = useWorkspaces();
  const workspaces = workspacesQuery.data?.workspaces ?? [];

  // Template query
  const templatesQuery = useQuery({
    queryKey: ['templates'],
    queryFn: () => client!.getTemplates(),
    enabled: !!client,
    staleTime: 30000,
  });
  const templates = templatesQuery.data?.templates ?? [];

  // Form state
  const [name, setName] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(
    defaultWorkspaceId || ''
  );
  const [workingDir, setWorkingDir] = useState('');
  const [command, setCommand] = useState('claude');
  const [model, setModel] = useState('');
  const [initialPrompt, setInitialPrompt] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Toast state
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVariant, setToastVariant] = useState<'success' | 'error'>('success');

  const { colors, spacing, radius } = theme;

  // Set default workspace when workspaces load and none selected
  useMemo(() => {
    if (!selectedWorkspaceId && workspaces.length > 0) {
      setSelectedWorkspaceId(defaultWorkspaceId || workspaces[0].id);
    }
  }, [workspaces, defaultWorkspaceId, selectedWorkspaceId]);

  /**
   * Apply a template to pre-fill form fields.
   * @param template - Template to apply
   */
  const handleTemplateSelect = useCallback(
    (template: SessionTemplate) => {
      setSelectedTemplateId(template.id);
      if (template.command) setCommand(template.command);
      if (template.workingDir) setWorkingDir(template.workingDir);
      if (template.model) setModel(template.model);
    },
    []
  );

  /**
   * Browse for a directory on the server.
   */
  const handleBrowse = useCallback(async () => {
    if (!client) return;
    try {
      const result = await client.browse(workingDir || '/');
      // For now, show the first directory as a simple picker
      // A full directory browser would be a separate component
      if (result.directories.length > 0) {
        setWorkingDir(result.directories[0]);
      }
    } catch {
      // Silently fail, user can type manually
    }
  }, [client, workingDir]);

  /**
   * Reset form fields to defaults.
   */
  const resetForm = useCallback(() => {
    setName('');
    setWorkingDir('');
    setCommand('claude');
    setModel('');
    setInitialPrompt('');
    setSelectedTemplateId(null);
  }, []);

  /**
   * Submit the form to create a new session.
   */
  const handleSubmit = useCallback(() => {
    if (!name.trim()) return;
    if (!selectedWorkspaceId) return;

    createMutation.mutate(
      {
        name: name.trim(),
        workspaceId: selectedWorkspaceId,
        workingDir: workingDir.trim() || '.',
        command: command.trim() || undefined,
        model: model.trim() || undefined,
        templateId: selectedTemplateId || undefined,
        initialPrompt: initialPrompt.trim() || undefined,
      },
      {
        onSuccess: () => {
          setToastMessage('Session created');
          setToastVariant('success');
          setToastVisible(true);
          resetForm();
          onClose();
        },
        onError: () => {
          setToastMessage('Failed to create session');
          setToastVariant('error');
          setToastVisible(true);
        },
      }
    );
  }, [
    name,
    selectedWorkspaceId,
    workingDir,
    command,
    model,
    selectedTemplateId,
    initialPrompt,
    createMutation,
    onClose,
    resetForm,
  ]);

  return (
    <>
      <ModalSheet visible={visible} onClose={onClose} title="New Session">
        <ScrollView
          showsVerticalScrollIndicator={false}
          style={{ maxHeight: 500 }}
        >
          {/* Name */}
          <Text
            style={[
              styles.fieldLabel,
              { color: colors.textSecondary, fontFamily: fonts.sans.medium },
            ]}
          >
            Name *
          </Text>
          <Input
            value={name}
            onChangeText={setName}
            placeholder="My Session"
            autoFocus
          />

          {/* Workspace picker */}
          <Text
            style={[
              styles.fieldLabel,
              { color: colors.textSecondary, fontFamily: fonts.sans.medium, marginTop: spacing.md },
            ]}
          >
            Workspace
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {workspaces.map((ws) => (
              <Chip
                key={ws.id}
                label={ws.name}
                selected={selectedWorkspaceId === ws.id}
                onPress={() => setSelectedWorkspaceId(ws.id)}
                color={ws.color || undefined}
              />
            ))}
          </ScrollView>

          {/* Working directory */}
          <Text
            style={[
              styles.fieldLabel,
              { color: colors.textSecondary, fontFamily: fonts.sans.medium, marginTop: spacing.md },
            ]}
          >
            Working Directory
          </Text>
          <View style={styles.dirRow}>
            <View style={styles.dirInput}>
              <Input
                value={workingDir}
                onChangeText={setWorkingDir}
                placeholder="/path/to/project"
              />
            </View>
            <Button variant="ghost" size="sm" onPress={handleBrowse}>
              Browse
            </Button>
          </View>

          {/* Command */}
          <Text
            style={[
              styles.fieldLabel,
              { color: colors.textSecondary, fontFamily: fonts.sans.medium, marginTop: spacing.md },
            ]}
          >
            Command
          </Text>
          <Input
            value={command}
            onChangeText={setCommand}
            placeholder="claude"
          />

          {/* Model */}
          <Text
            style={[
              styles.fieldLabel,
              { color: colors.textSecondary, fontFamily: fonts.sans.medium, marginTop: spacing.md },
            ]}
          >
            Model (optional)
          </Text>
          <Input
            value={model}
            onChangeText={setModel}
            placeholder="opus, sonnet, etc."
          />

          {/* Template chips */}
          {templates.length > 0 ? (
            <>
              <Text
                style={[
                  styles.fieldLabel,
                  { color: colors.textSecondary, fontFamily: fonts.sans.medium, marginTop: spacing.md },
                ]}
              >
                Templates
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                {templates.map((tpl) => (
                  <Chip
                    key={tpl.id}
                    label={tpl.name}
                    selected={selectedTemplateId === tpl.id}
                    onPress={() => handleTemplateSelect(tpl)}
                  />
                ))}
              </ScrollView>
            </>
          ) : null}

          {/* Initial prompt */}
          <Text
            style={[
              styles.fieldLabel,
              { color: colors.textSecondary, fontFamily: fonts.sans.medium, marginTop: spacing.md },
            ]}
          >
            Initial Prompt (optional)
          </Text>
          <Input
            value={initialPrompt}
            onChangeText={setInitialPrompt}
            placeholder="What should Claude work on?"
            multiline
          />

          {/* Submit */}
          <View style={styles.submitRow}>
            <Button variant="ghost" onPress={onClose}>
              Cancel
            </Button>
            <Button
              onPress={handleSubmit}
              disabled={!name.trim() || !selectedWorkspaceId}
              loading={createMutation.isPending}
            >
              Create Session
            </Button>
          </View>
        </ScrollView>
      </ModalSheet>

      {/* Toast */}
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
  fieldLabel: {
    fontSize: 13,
    marginBottom: 6,
  },
  chipRow: {
    gap: 8,
    paddingVertical: 4,
  },
  dirRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dirInput: {
    flex: 1,
  },
  submitRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 20,
    marginBottom: 8,
  },
});
