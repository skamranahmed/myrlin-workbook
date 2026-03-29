/**
 * DocItemRow.tsx - Single doc item row with inline editing and swipe-to-delete.
 *
 * Renders a row for a doc section item. Supports:
 * - Checkbox for goals/tasks (toggles done state)
 * - Status badge for roadmap items (planned/active/done)
 * - Tap text to inline edit, blur to save
 * - Delete button on the right side
 *
 * Uses callbacks from the parent for mutation operations to keep
 * this component presentation-only.
 */

import React, { useCallback, useMemo, useState, useRef } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  View,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import { Badge } from '@/components/ui';
import type { DocSection } from '@/types/api';

/** Props for DocItemRow */
export interface DocItemRowProps {
  /** The item data (text, done, status depending on section) */
  item: Record<string, unknown>;
  /** Which doc section this item belongs to */
  section: DocSection;
  /** Index within the section array */
  index: number;
  /** Parent workspace ID */
  workspaceId: string;
  /** Called when a checkbox is toggled (goals/tasks) */
  onToggle: (index: number, done: boolean) => void;
  /** Called when the item text is edited */
  onEdit: (index: number, updatedItem: Record<string, unknown>) => void;
  /** Called when the item should be deleted */
  onDelete: (index: number) => void;
}

/**
 * Maps roadmap status to badge variant for visual differentiation.
 * @param status - Roadmap item status
 * @returns Badge variant name
 */
function statusToBadgeVariant(
  status: string
): 'info' | 'warning' | 'success' {
  switch (status) {
    case 'active':
      return 'warning';
    case 'done':
      return 'success';
    default:
      return 'info';
  }
}

/**
 * DocItemRow - Renders a single doc item with editing, deletion,
 * and section-specific controls (checkboxes, status badges).
 *
 * @param props - DocItemRow configuration
 */
export function DocItemRow({
  item,
  section,
  index,
  onToggle,
  onEdit,
  onDelete,
}: DocItemRowProps) {
  const { theme } = useTheme();
  const { colors, spacing, typography } = theme;

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(String(item.text ?? ''));
  const inputRef = useRef<TextInput>(null);

  const isDone = Boolean(item.done);
  const hasCheckbox = section === 'goals' || section === 'tasks';
  const isRoadmap = section === 'roadmap';

  /** Start inline editing mode */
  const handleStartEdit = useCallback(() => {
    setEditText(String(item.text ?? ''));
    setIsEditing(true);
    // Auto-focus the input after state update
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [item.text]);

  /** Save the edited text and exit editing mode */
  const handleSaveEdit = useCallback(() => {
    setIsEditing(false);
    const newText = editText.trim();
    if (newText && newText !== String(item.text)) {
      onEdit(index, { ...item, text: newText });
    }
  }, [editText, item, index, onEdit]);

  /** Toggle the done state for goals/tasks */
  const handleToggle = useCallback(() => {
    onToggle(index, !isDone);
  }, [index, isDone, onToggle]);

  const rowStyle = useMemo<ViewStyle>(
    () => ({
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      gap: spacing.sm,
    }),
    [spacing]
  );

  const textStyle = useMemo<TextStyle>(
    () => ({
      flex: 1,
      color: isDone ? colors.textMuted : colors.textPrimary,
      fontFamily: fonts.sans.regular,
      fontSize: typography.sizes.sm,
      textDecorationLine: isDone ? 'line-through' : 'none',
    }),
    [isDone, colors, typography]
  );

  const inputStyle = useMemo<TextStyle>(
    () => ({
      flex: 1,
      color: colors.textPrimary,
      fontFamily: fonts.sans.regular,
      fontSize: typography.sizes.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.accent,
      paddingVertical: 2,
      paddingHorizontal: 0,
    }),
    [colors, typography]
  );

  return (
    <View style={rowStyle}>
      {/* Checkbox for goals and tasks */}
      {hasCheckbox ? (
        <Pressable onPress={handleToggle} hitSlop={8}>
          <Ionicons
            name={isDone ? 'checkbox' : 'square-outline'}
            size={20}
            color={isDone ? colors.green : colors.textSecondary}
          />
        </Pressable>
      ) : null}

      {/* Roadmap status badge */}
      {isRoadmap && item.status ? (
        <Badge variant={statusToBadgeVariant(String(item.status))}>
          {String(item.status)}
        </Badge>
      ) : null}

      {/* Text content (inline edit or display) */}
      {isEditing ? (
        <TextInput
          ref={inputRef}
          style={inputStyle}
          value={editText}
          onChangeText={setEditText}
          onBlur={handleSaveEdit}
          onSubmitEditing={handleSaveEdit}
          returnKeyType="done"
          autoFocus
        />
      ) : (
        <Pressable style={{ flex: 1 }} onPress={handleStartEdit}>
          <Text style={textStyle} numberOfLines={2}>
            {String(item.text ?? '')}
          </Text>
        </Pressable>
      )}

      {/* Delete button */}
      <Pressable
        onPress={() => onDelete(index)}
        hitSlop={8}
        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 0.7 })}
      >
        <Ionicons name="trash-outline" size={18} color={colors.red} />
      </Pressable>
    </View>
  );
}
