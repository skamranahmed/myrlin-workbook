/**
 * DocSection.tsx - Collapsible doc section with header, item list, and inline add.
 *
 * Renders a section of workspace docs (notes, goals, tasks, roadmap, rules)
 * with expand/collapse animation, item count badge, add button, and a list
 * of DocItemRow components when expanded. The inline add input appears at
 * the bottom of the expanded list for quick item creation.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  Text,
  TextInput,
  UIManager,
  View,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import { Badge } from '@/components/ui';
import { DocItemRow } from './DocItemRow';
import type { DocSection as DocSectionType } from '@/types/api';

// Enable LayoutAnimation on Android
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** Props for DocSection */
export interface DocSectionProps {
  /** Section display title */
  title: string;
  /** Section identifier for API calls */
  section: DocSectionType;
  /** Items in this section */
  items: Record<string, unknown>[];
  /** Parent workspace ID */
  workspaceId: string;
  /** Called when a new item should be added */
  onAdd: (section: DocSectionType, item: Record<string, unknown>) => void;
  /** Called when an item should be updated */
  onUpdate: (
    section: DocSectionType,
    index: number,
    item: Record<string, unknown>
  ) => void;
  /** Called when an item should be deleted */
  onDelete: (section: DocSectionType, index: number) => void;
}

/**
 * Creates the default item shape for a given section type.
 * Goals and tasks default to done: false, roadmap defaults to planned.
 *
 * @param section - Doc section type
 * @param text - Item text content
 * @returns New item object with section-appropriate defaults
 */
function createDefaultItem(
  section: DocSectionType,
  text: string
): Record<string, unknown> {
  switch (section) {
    case 'goals':
    case 'tasks':
      return { text, done: false };
    case 'roadmap':
      return { text, status: 'planned' };
    default:
      return { text };
  }
}

/**
 * DocSection - Collapsible section with header, items, and inline add.
 *
 * @param props - DocSection configuration
 */
export function DocSection({
  title,
  section,
  items,
  workspaceId,
  onAdd,
  onUpdate,
  onDelete,
}: DocSectionProps) {
  const { theme } = useTheme();
  const { colors, spacing, typography, radius } = theme;

  const [expanded, setExpanded] = useState(true);
  const [showAddInput, setShowAddInput] = useState(false);
  const [addText, setAddText] = useState('');

  /** Toggle section expanded/collapsed with animation */
  const handleToggle = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => !prev);
  }, []);

  /** Show the inline add input */
  const handleShowAdd = useCallback(() => {
    if (!expanded) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setExpanded(true);
    }
    setShowAddInput(true);
  }, [expanded]);

  /** Submit the new item */
  const handleSubmitAdd = useCallback(() => {
    const text = addText.trim();
    if (text) {
      onAdd(section, createDefaultItem(section, text));
      setAddText('');
    }
    setShowAddInput(false);
  }, [addText, onAdd, section]);

  /** Handle checkbox toggle for goals/tasks */
  const handleToggleItem = useCallback(
    (index: number, done: boolean) => {
      const item = items[index];
      if (item) {
        onUpdate(section, index, { ...item, done });
      }
    },
    [items, onUpdate, section]
  );

  /** Handle inline edit save */
  const handleEditItem = useCallback(
    (index: number, updatedItem: Record<string, unknown>) => {
      onUpdate(section, index, updatedItem);
    },
    [onUpdate, section]
  );

  /** Handle item deletion */
  const handleDeleteItem = useCallback(
    (index: number) => {
      onDelete(section, index);
    },
    [onDelete, section]
  );

  const headerStyle = useMemo<ViewStyle>(
    () => ({
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      backgroundColor: colors.surface0,
      borderRadius: radius.md,
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
    }),
    [colors, spacing, radius]
  );

  const headerLeftStyle = useMemo<ViewStyle>(
    () => ({
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    }),
    [spacing]
  );

  const titleStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textPrimary,
      fontFamily: fonts.sans.semibold,
      fontSize: typography.sizes.sm,
      textTransform: 'capitalize',
    }),
    [colors, typography]
  );

  const addInputStyle = useMemo<TextStyle>(
    () => ({
      color: colors.textPrimary,
      fontFamily: fonts.sans.regular,
      fontSize: typography.sizes.sm,
      backgroundColor: colors.surface0,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginHorizontal: spacing.md,
      marginTop: spacing.xs,
      borderWidth: 1,
      borderColor: colors.accent,
    }),
    [colors, typography, radius, spacing]
  );

  const contentStyle = useMemo<ViewStyle>(
    () => ({
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      marginHorizontal: spacing.md,
      marginTop: spacing.xs,
      overflow: 'hidden',
    }),
    [colors, radius, spacing]
  );

  return (
    <View>
      {/* Section header */}
      <Pressable onPress={handleToggle} style={headerStyle}>
        <View style={headerLeftStyle}>
          <Ionicons
            name={expanded ? 'chevron-down' : 'chevron-forward'}
            size={16}
            color={colors.textSecondary}
          />
          <Text style={titleStyle}>{title}</Text>
          <Badge>{String(items.length)}</Badge>
        </View>

        <Pressable onPress={handleShowAdd} hitSlop={8}>
          <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
        </Pressable>
      </Pressable>

      {/* Expanded content */}
      {expanded ? (
        <View style={contentStyle}>
          {items.length === 0 ? (
            <View style={{ padding: spacing.md, alignItems: 'center' }}>
              <Text
                style={{
                  color: colors.textMuted,
                  fontFamily: fonts.sans.regular,
                  fontSize: typography.sizes.sm,
                }}
              >
                No {section} yet
              </Text>
            </View>
          ) : (
            items.map((item, idx) => (
              <DocItemRow
                key={`${section}-${idx}`}
                item={item}
                section={section}
                index={idx}
                workspaceId={workspaceId}
                onToggle={handleToggleItem}
                onEdit={handleEditItem}
                onDelete={handleDeleteItem}
              />
            ))
          )}
        </View>
      ) : null}

      {/* Inline add input */}
      {showAddInput ? (
        <TextInput
          style={addInputStyle}
          placeholder={`Add ${section.slice(0, -1)}...`}
          placeholderTextColor={colors.textMuted}
          value={addText}
          onChangeText={setAddText}
          onBlur={handleSubmitAdd}
          onSubmitEditing={handleSubmitAdd}
          returnKeyType="done"
          autoFocus
        />
      ) : null}
    </View>
  );
}
