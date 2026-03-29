/**
 * WorkspaceActions.tsx - Action sheet for workspace CRUD operations.
 *
 * Provides rename, change color, edit description, and delete actions
 * for a workspace. Each action opens a sub-modal (ModalSheet) with the
 * appropriate form. The color picker shows a grid of 14 Catppuccin palette
 * swatches. Delete requires confirmation before proceeding.
 */

import React, { useCallback, useState, useMemo } from 'react';
import {
  Alert,
  Pressable,
  Text,
  View,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import { ActionSheet } from '@/components/ui/ActionSheet';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useUpdateWorkspace, useDeleteWorkspace } from '@/hooks/useWorkspaces';
import type { Workspace } from '@/types/api';

/** Props for WorkspaceActions */
export interface WorkspaceActionsProps {
  /** The workspace to operate on */
  workspace: Workspace;
  /** Whether the action sheet is visible */
  visible: boolean;
  /** Called when the action sheet should close */
  onClose: () => void;
  /** Called when a toast message should be shown */
  onToast?: (message: string, variant: 'success' | 'error') => void;
}

/**
 * Catppuccin palette colors for the color picker.
 * Each entry maps a name to a hex value matching the Catppuccin Mocha palette.
 */
const PALETTE_COLORS = [
  { name: 'Rosewater', hex: '#f5e0dc' },
  { name: 'Flamingo', hex: '#f2cdcd' },
  { name: 'Pink', hex: '#f5c2e7' },
  { name: 'Mauve', hex: '#cba6f7' },
  { name: 'Red', hex: '#f38ba8' },
  { name: 'Maroon', hex: '#eba0ac' },
  { name: 'Peach', hex: '#fab387' },
  { name: 'Yellow', hex: '#f9e2af' },
  { name: 'Green', hex: '#a6e3a1' },
  { name: 'Teal', hex: '#94e2d5' },
  { name: 'Sky', hex: '#89dceb' },
  { name: 'Sapphire', hex: '#74c7ec' },
  { name: 'Blue', hex: '#89b4fa' },
  { name: 'Lavender', hex: '#b4befe' },
] as const;

/**
 * WorkspaceActions - Action sheet with rename, color, description, and delete.
 *
 * Opens sub-modals for each editing action. Delete shows a native Alert
 * for confirmation. Success/error feedback via the onToast callback.
 *
 * @param props - WorkspaceActions configuration
 */
export function WorkspaceActions({
  workspace,
  visible,
  onClose,
  onToast,
}: WorkspaceActionsProps) {
  const { theme } = useTheme();
  const { colors, spacing, radius, typography } = theme;

  const updateMutation = useUpdateWorkspace();
  const deleteMutation = useDeleteWorkspace();

  // Sub-modal visibility state
  const [renameVisible, setRenameVisible] = useState(false);
  const [colorVisible, setColorVisible] = useState(false);
  const [descVisible, setDescVisible] = useState(false);

  // Form state for rename
  const [newName, setNewName] = useState(workspace.name);

  // Form state for description
  const [newDesc, setNewDesc] = useState(workspace.description);

  /**
   * Handle rename submission.
   * Validates non-empty name, calls update mutation, shows toast.
   */
  const handleRename = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    try {
      await updateMutation.mutateAsync({ id: workspace.id, data: { name: trimmed } });
      onToast?.('Workspace renamed', 'success');
      setRenameVisible(false);
    } catch {
      onToast?.('Failed to rename workspace', 'error');
    }
  }, [newName, workspace.id, updateMutation, onToast]);

  /**
   * Handle color selection from the palette grid.
   * Calls update mutation with the selected hex color.
   */
  const handleColorSelect = useCallback(
    async (hex: string) => {
      try {
        await updateMutation.mutateAsync({ id: workspace.id, data: { color: hex } });
        onToast?.('Color updated', 'success');
        setColorVisible(false);
      } catch {
        onToast?.('Failed to update color', 'error');
      }
    },
    [workspace.id, updateMutation, onToast]
  );

  /**
   * Handle description update submission.
   * Calls update mutation with the new description text.
   */
  const handleDescUpdate = useCallback(async () => {
    try {
      await updateMutation.mutateAsync({
        id: workspace.id,
        data: { description: newDesc.trim() },
      });
      onToast?.('Description updated', 'success');
      setDescVisible(false);
    } catch {
      onToast?.('Failed to update description', 'error');
    }
  }, [newDesc, workspace.id, updateMutation, onToast]);

  /**
   * Handle workspace deletion with native confirmation dialog.
   * Shows Alert for confirmation, calls delete mutation on confirm.
   */
  const handleDelete = useCallback(() => {
    Alert.alert(
      'Delete Workspace',
      `Are you sure you want to delete "${workspace.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMutation.mutateAsync(workspace.id);
              onToast?.('Workspace deleted', 'success');
              onClose();
            } catch {
              onToast?.('Failed to delete workspace', 'error');
            }
          },
        },
      ]
    );
  }, [workspace, deleteMutation, onToast, onClose]);

  /** Color swatch grid container style */
  const swatchGridStyle = useMemo<ViewStyle>(
    () => ({
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      justifyContent: 'center',
      paddingVertical: spacing.md,
    }),
    [spacing]
  );

  /** Individual color swatch style builder */
  const getSwatchStyle = useCallback(
    (hex: string, isSelected: boolean): ViewStyle => ({
      width: 40,
      height: 40,
      borderRadius: radius.full,
      backgroundColor: hex,
      borderWidth: isSelected ? 3 : 0,
      borderColor: isSelected ? colors.textPrimary : 'transparent',
    }),
    [radius, colors]
  );

  /** Action sheet item definitions */
  const actions = useMemo(
    () => [
      {
        label: 'Rename',
        icon: (
          <Ionicons name="pencil-outline" size={20} color={colors.textPrimary} />
        ),
        onPress: () => {
          setNewName(workspace.name);
          setRenameVisible(true);
        },
      },
      {
        label: 'Change Color',
        icon: (
          <Ionicons
            name="color-palette-outline"
            size={20}
            color={colors.textPrimary}
          />
        ),
        onPress: () => setColorVisible(true),
      },
      {
        label: 'Edit Description',
        icon: (
          <Ionicons
            name="document-text-outline"
            size={20}
            color={colors.textPrimary}
          />
        ),
        onPress: () => {
          setNewDesc(workspace.description);
          setDescVisible(true);
        },
      },
      {
        label: 'Delete Workspace',
        icon: <Ionicons name="trash-outline" size={20} color={colors.red} />,
        destructive: true,
        onPress: handleDelete,
      },
    ],
    [colors, workspace, handleDelete]
  );

  /** Color swatch label style */
  const swatchLabelStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textSecondary,
      fontFamily: fonts.sans.regular,
      fontSize: typography.sizes.xs,
      textAlign: 'center',
      marginTop: 2,
    }),
    [colors, typography]
  );

  return (
    <>
      {/* Main action sheet */}
      <ActionSheet visible={visible} onClose={onClose} actions={actions} />

      {/* Rename sub-modal */}
      <ModalSheet
        visible={renameVisible}
        onClose={() => setRenameVisible(false)}
        title="Rename Workspace"
      >
        <View style={{ gap: spacing.md }}>
          <Input
            label="Name"
            value={newName}
            onChangeText={setNewName}
            placeholder="Workspace name"
            autoFocus
          />
          <Button
            onPress={handleRename}
            disabled={!newName.trim()}
            loading={updateMutation.isPending}
          >
            Save
          </Button>
        </View>
      </ModalSheet>

      {/* Color picker sub-modal */}
      <ModalSheet
        visible={colorVisible}
        onClose={() => setColorVisible(false)}
        title="Choose Color"
      >
        <View style={swatchGridStyle}>
          {PALETTE_COLORS.map((swatch) => {
            const isSelected =
              workspace.color?.toLowerCase() === swatch.hex.toLowerCase();

            return (
              <Pressable
                key={swatch.hex}
                onPress={() => handleColorSelect(swatch.hex)}
                style={{ alignItems: 'center', width: 56 }}
              >
                <View style={getSwatchStyle(swatch.hex, isSelected)} />
                <Text style={swatchLabelStyle}>{swatch.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </ModalSheet>

      {/* Description edit sub-modal */}
      <ModalSheet
        visible={descVisible}
        onClose={() => setDescVisible(false)}
        title="Edit Description"
      >
        <View style={{ gap: spacing.md }}>
          <Input
            label="Description"
            value={newDesc}
            onChangeText={setNewDesc}
            placeholder="What is this workspace for?"
            multiline
            numberOfLines={3}
            style={{ minHeight: 80 }}
          />
          <Button
            onPress={handleDescUpdate}
            loading={updateMutation.isPending}
          >
            Save
          </Button>
        </View>
      </ModalSheet>
    </>
  );
}
