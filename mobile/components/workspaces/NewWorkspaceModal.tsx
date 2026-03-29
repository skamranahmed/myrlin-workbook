/**
 * NewWorkspaceModal.tsx - Modal form for creating a new workspace.
 *
 * Presents a ModalSheet with name input, description input, and a
 * 14-swatch Catppuccin color picker. Validates that name is non-empty
 * before submission. On success, closes the modal and fires a toast.
 */

import React, { useCallback, useState, useMemo } from 'react';
import { Pressable, Text, View, type ViewStyle, type TextStyle } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useCreateWorkspace } from '@/hooks/useWorkspaces';

/** Props for the NewWorkspaceModal component */
export interface NewWorkspaceModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** Called when the modal should close */
  onClose: () => void;
  /** Called when a toast message should be shown */
  onToast?: (message: string, variant: 'success' | 'error') => void;
}

/**
 * Catppuccin palette colors for the color picker grid.
 * Same set used in WorkspaceActions for visual consistency.
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

/** Default color for new workspaces (first accent: Rosewater) */
const DEFAULT_COLOR = PALETTE_COLORS[0].hex;

/**
 * NewWorkspaceModal - Form modal for creating a workspace with name,
 * description, and color selection.
 *
 * Resets form fields when opened. Validates name is non-empty before
 * allowing submission. Shows loading state during creation.
 *
 * @param props - NewWorkspaceModal configuration
 */
export function NewWorkspaceModal({
  visible,
  onClose,
  onToast,
}: NewWorkspaceModalProps) {
  const { theme } = useTheme();
  const { colors, spacing, radius, typography } = theme;

  const createMutation = useCreateWorkspace();

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedColor, setSelectedColor] = useState<string>(DEFAULT_COLOR);
  const [nameError, setNameError] = useState('');

  /**
   * Reset form state when modal opens.
   * Uses React effect-free approach: reset on visibility change.
   */
  const handleOpen = useCallback(() => {
    setName('');
    setDescription('');
    setSelectedColor(DEFAULT_COLOR);
    setNameError('');
  }, []);

  // Reset form when modal becomes visible
  React.useEffect(() => {
    if (visible) {
      handleOpen();
    }
  }, [visible, handleOpen]);

  /**
   * Validate and submit the new workspace.
   * Sets error state if name is empty, otherwise creates the workspace.
   */
  const handleSubmit = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError('Name is required');
      return;
    }

    try {
      await createMutation.mutateAsync({
        name: trimmedName,
        description: description.trim() || undefined,
        color: selectedColor,
      });
      onToast?.('Workspace created', 'success');
      onClose();
    } catch {
      onToast?.('Failed to create workspace', 'error');
    }
  }, [name, description, selectedColor, createMutation, onToast, onClose]);

  /** Color swatch grid container style */
  const swatchGridStyle = useMemo<ViewStyle>(
    () => ({
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      justifyContent: 'center',
      paddingVertical: spacing.sm,
    }),
    [spacing]
  );

  /** Build style for an individual color swatch */
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

  /** Swatch label text style */
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

  /** Section label style for "Color" heading */
  const sectionLabelStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textSecondary,
      fontFamily: fonts.sans.medium,
      fontSize: typography.sizes.sm,
    }),
    [colors, typography]
  );

  return (
    <ModalSheet visible={visible} onClose={onClose} title="New Workspace">
      <View style={{ gap: spacing.md }}>
        {/* Name input */}
        <Input
          label="Name"
          value={name}
          onChangeText={(text) => {
            setName(text);
            if (nameError) setNameError('');
          }}
          placeholder="Workspace name"
          error={nameError}
          autoFocus
        />

        {/* Description input */}
        <Input
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="What is this workspace for?"
          multiline
          numberOfLines={2}
        />

        {/* Color picker */}
        <View style={{ gap: spacing.xs }}>
          <Text style={sectionLabelStyle}>Color</Text>
          <View style={swatchGridStyle}>
            {PALETTE_COLORS.map((swatch) => {
              const isSelected =
                selectedColor.toLowerCase() === swatch.hex.toLowerCase();

              return (
                <Pressable
                  key={swatch.hex}
                  onPress={() => setSelectedColor(swatch.hex)}
                  style={{ alignItems: 'center', width: 56 }}
                >
                  <View style={getSwatchStyle(swatch.hex, isSelected)} />
                  <Text style={swatchLabelStyle}>{swatch.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Submit button */}
        <Button
          onPress={handleSubmit}
          disabled={!name.trim()}
          loading={createMutation.isPending}
        >
          Create Workspace
        </Button>
      </View>
    </ModalSheet>
  );
}
