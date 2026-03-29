/**
 * FeatureBoard.tsx - 3-column kanban board for workspace features.
 *
 * Displays features in Backlog, Active, and Done columns as a
 * horizontally scrollable kanban board. Each column is a vertical
 * ScrollView of FeatureCard components. Status changes are done
 * via ActionSheet (long press on card) for reliability over drag-drop.
 *
 * Includes a FAB (floating action button) to create new features
 * via a ModalSheet with name, description, and priority inputs.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import { Badge, Button, Input, ModalSheet, SegmentedControl } from '@/components/ui';
import { FeatureCard } from './FeatureCard';
import type { Feature } from '@/types/api';

/** Column definition for the kanban board */
interface KanbanColumn {
  /** Column status key */
  status: Feature['status'];
  /** Column display label */
  label: string;
  /** Column header accent color */
  color: string;
}

/** Props for FeatureBoard */
export interface FeatureBoardProps {
  /** All features for the workspace */
  features: Feature[];
  /** Called when a new feature should be created */
  onCreate: (data: {
    name: string;
    description?: string;
    priority?: string;
  }) => void;
  /** Called when a feature should be updated */
  onUpdate: (id: string, data: Partial<Feature>) => void;
  /** Called when a feature should be deleted */
  onDelete: (id: string) => void;
}

/** Priority options for the create/edit modal */
const PRIORITY_OPTIONS = ['low', 'medium', 'high'];

/**
 * FeatureBoard - Horizontal 3-column kanban for feature management.
 *
 * @param props - FeatureBoard configuration
 */
export function FeatureBoard({
  features,
  onCreate,
  onUpdate,
  onDelete,
}: FeatureBoardProps) {
  const { theme } = useTheme();
  const { colors, spacing, typography, radius, shadows } = theme;

  // Create modal state
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPriority, setNewPriority] = useState<string>('medium');

  // Edit modal state
  const [editFeature, setEditFeature] = useState<Feature | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  /** Column definitions with themed colors */
  const columns = useMemo<KanbanColumn[]>(
    () => [
      { status: 'backlog', label: 'Backlog', color: colors.blue },
      { status: 'active', label: 'Active', color: colors.yellow },
      { status: 'done', label: 'Done', color: colors.green },
    ],
    [colors]
  );

  /** Group features by status */
  const featuresByStatus = useMemo(() => {
    const grouped: Record<Feature['status'], Feature[]> = {
      backlog: [],
      active: [],
      done: [],
    };
    for (const f of features) {
      if (grouped[f.status]) {
        grouped[f.status].push(f);
      }
    }
    return grouped;
  }, [features]);

  /** Handle feature creation */
  const handleCreate = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    onCreate({
      name,
      description: newDesc.trim() || undefined,
      priority: newPriority,
    });
    setNewName('');
    setNewDesc('');
    setNewPriority('medium');
    setShowCreate(false);
  }, [newName, newDesc, newPriority, onCreate]);

  /** Handle opening the edit modal */
  const handleEdit = useCallback((feature: Feature) => {
    setEditFeature(feature);
    setEditName(feature.name);
    setEditDesc(feature.description ?? '');
  }, []);

  /** Handle saving the edit */
  const handleSaveEdit = useCallback(() => {
    if (!editFeature) return;
    onUpdate(editFeature.id, {
      name: editName.trim() || editFeature.name,
      description: editDesc.trim() || undefined,
    });
    setEditFeature(null);
  }, [editFeature, editName, editDesc, onUpdate]);

  /** Handle status change from ActionSheet */
  const handleChangeStatus = useCallback(
    (feature: Feature, status: Feature['status']) => {
      onUpdate(feature.id, { status });
    },
    [onUpdate]
  );

  /** Handle feature deletion */
  const handleDelete = useCallback(
    (feature: Feature) => {
      onDelete(feature.id);
    },
    [onDelete]
  );

  const columnStyle = useMemo<ViewStyle>(
    () => ({
      width: 280,
      marginRight: spacing.md,
    }),
    [spacing]
  );

  const columnHeaderStyle = useCallback(
    (color: string): ViewStyle => ({
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: color + '18',
      borderRadius: radius.md,
      marginBottom: spacing.sm,
    }),
    [spacing, radius]
  );

  const columnLabelStyle = useCallback(
    (color: string): TextStyle => ({
      color,
      fontFamily: fonts.sans.semibold,
      fontSize: typography.sizes.sm,
    }),
    [typography]
  );

  const fabStyle = useMemo<ViewStyle>(
    () => ({
      position: 'absolute',
      bottom: spacing.lg,
      right: spacing.lg,
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadows.md,
    }),
    [colors, spacing, shadows]
  );

  return (
    <View style={{ flex: 1 }}>
      {/* Horizontal scroll for columns */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        }}
      >
        {columns.map((col) => {
          const colFeatures = featuresByStatus[col.status];
          return (
            <View key={col.status} style={columnStyle}>
              {/* Column header */}
              <View style={columnHeaderStyle(col.color)}>
                <Text style={columnLabelStyle(col.color)}>{col.label}</Text>
                <Badge>{String(colFeatures.length)}</Badge>
              </View>

              {/* Column content */}
              <ScrollView
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
                style={{ flex: 1 }}
              >
                {colFeatures.length === 0 ? (
                  <View
                    style={{
                      padding: spacing.lg,
                      alignItems: 'center',
                      borderRadius: radius.md,
                      borderWidth: 1,
                      borderColor: colors.borderSubtle,
                      borderStyle: 'dashed',
                    }}
                  >
                    <Text
                      style={{
                        color: colors.textMuted,
                        fontFamily: fonts.sans.regular,
                        fontSize: typography.sizes.xs,
                      }}
                    >
                      No features
                    </Text>
                  </View>
                ) : (
                  colFeatures.map((feature) => (
                    <FeatureCard
                      key={feature.id}
                      feature={feature}
                      onEdit={handleEdit}
                      onChangeStatus={handleChangeStatus}
                      onDelete={handleDelete}
                    />
                  ))
                )}
              </ScrollView>
            </View>
          );
        })}
      </ScrollView>

      {/* FAB for creating new features */}
      <Pressable
        style={({ pressed }) => [fabStyle, { opacity: pressed ? 0.85 : 1 }]}
        onPress={() => setShowCreate(true)}
      >
        <Ionicons name="add" size={28} color={colors.crust} />
      </Pressable>

      {/* Create feature modal */}
      <ModalSheet
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        title="New Feature"
      >
        <Input
          placeholder="Feature name"
          value={newName}
          onChangeText={setNewName}
        />
        <View style={{ height: spacing.sm }} />
        <Input
          placeholder="Description (optional)"
          value={newDesc}
          onChangeText={setNewDesc}
        />
        <View style={{ height: spacing.md }} />
        <Text
          style={{
            color: colors.textSecondary,
            fontFamily: fonts.sans.medium,
            fontSize: typography.sizes.xs,
            marginBottom: spacing.xs,
          }}
        >
          PRIORITY
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {PRIORITY_OPTIONS.map((p) => (
            <Pressable
              key={p}
              onPress={() => setNewPriority(p)}
              style={{
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
                borderRadius: radius.full,
                backgroundColor:
                  newPriority === p ? colors.accent : colors.surface0,
              }}
            >
              <Text
                style={{
                  color: newPriority === p ? colors.crust : colors.textSecondary,
                  fontFamily: fonts.sans.medium,
                  fontSize: typography.sizes.sm,
                  textTransform: 'capitalize',
                }}
              >
                {p}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={{ height: spacing.lg }} />
        <Button onPress={handleCreate}>Create Feature</Button>
      </ModalSheet>

      {/* Edit feature modal */}
      <ModalSheet
        visible={!!editFeature}
        onClose={() => setEditFeature(null)}
        title="Edit Feature"
      >
        <Input
          placeholder="Feature name"
          value={editName}
          onChangeText={setEditName}
        />
        <View style={{ height: spacing.sm }} />
        <Input
          placeholder="Description (optional)"
          value={editDesc}
          onChangeText={setEditDesc}
        />
        <View style={{ height: spacing.lg }} />
        <Button onPress={handleSaveEdit}>Save</Button>
      </ModalSheet>
    </View>
  );
}
