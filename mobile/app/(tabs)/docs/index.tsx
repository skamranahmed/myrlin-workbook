/**
 * docs/index.tsx - Workspace docs and feature board screen.
 *
 * Displays workspace documentation with 5 collapsible sections
 * (notes, goals, tasks, roadmap, rules) and a feature kanban board.
 * Includes a workspace picker at the top and a Docs/Board tab toggle.
 *
 * Uses useWorkspaceDocs and useFeatures hooks for data fetching,
 * with pull-to-refresh support and loading skeletons.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import {
  Chip,
  EmptyState,
  SegmentedControl,
  Skeleton,
} from '@/components/ui';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import {
  useWorkspaceDocs,
  useAddDocItem,
  useUpdateDocItem,
  useDeleteDocItem,
  useFeatures,
  useCreateFeature,
  useUpdateFeature,
  useDeleteFeature,
} from '@/hooks/useDocs';
import { DocSection } from '@/components/docs/DocSection';
import { FeatureBoard } from '@/components/docs/FeatureBoard';
import type { DocSection as DocSectionType, Feature } from '@/types/api';

/** Available tab segments */
const TABS = ['Docs', 'Board'];

/** All 5 doc section keys in display order */
const DOC_SECTIONS: { key: DocSectionType; label: string }[] = [
  { key: 'notes', label: 'Notes' },
  { key: 'goals', label: 'Goals' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'roadmap', label: 'Roadmap' },
  { key: 'rules', label: 'Rules' },
];

/**
 * DocsScreen - Full workspace docs screen with section management and feature board.
 */
export default function DocsScreen() {
  const { theme } = useTheme();
  const { colors, spacing, typography } = theme;

  // Active tab (Docs or Board)
  const [activeTab, setActiveTab] = useState(0);

  // Workspace selection
  const { data: wsData, isLoading: wsLoading } = useWorkspaces();
  const workspaces = wsData?.workspaces ?? [];
  const [selectedWsId, setSelectedWsId] = useState<string>('');

  // Resolve workspace ID (default to first)
  const workspaceId = selectedWsId || workspaces[0]?.id || '';

  // Docs data
  const {
    data: docsData,
    isLoading: docsLoading,
    refetch: refetchDocs,
  } = useWorkspaceDocs(workspaceId);
  const docs = docsData?.docs;

  // Features data
  const {
    data: featuresData,
    isLoading: featuresLoading,
    refetch: refetchFeatures,
  } = useFeatures(workspaceId);
  const features = featuresData?.features ?? [];

  // Doc mutations
  const addDocItem = useAddDocItem();
  const updateDocItem = useUpdateDocItem();
  const deleteDocItem = useDeleteDocItem();

  // Feature mutations
  const createFeature = useCreateFeature();
  const updateFeature = useUpdateFeature();
  const deleteFeature = useDeleteFeature();

  // Pull-to-refresh state
  const [refreshing, setRefreshing] = useState(false);

  /** Handle pull-to-refresh */
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchDocs(), refetchFeatures()]);
    setRefreshing(false);
  }, [refetchDocs, refetchFeatures]);

  /** Add a new item to a doc section */
  const handleAddItem = useCallback(
    (section: DocSectionType, item: Record<string, unknown>) => {
      if (!workspaceId) return;
      addDocItem.mutate({ workspaceId, section, item });
    },
    [workspaceId, addDocItem]
  );

  /** Update an item in a doc section */
  const handleUpdateItem = useCallback(
    (
      section: DocSectionType,
      index: number,
      item: Record<string, unknown>
    ) => {
      if (!workspaceId) return;
      updateDocItem.mutate({ workspaceId, section, index, item });
    },
    [workspaceId, updateDocItem]
  );

  /** Delete an item from a doc section */
  const handleDeleteItem = useCallback(
    (section: DocSectionType, index: number) => {
      if (!workspaceId) return;
      deleteDocItem.mutate({ workspaceId, section, index });
    },
    [workspaceId, deleteDocItem]
  );

  /** Create a new feature */
  const handleCreateFeature = useCallback(
    (data: { name: string; description?: string; priority?: string }) => {
      if (!workspaceId) return;
      createFeature.mutate({ workspaceId, data });
    },
    [workspaceId, createFeature]
  );

  /** Update a feature */
  const handleUpdateFeature = useCallback(
    (id: string, data: Partial<Feature>) => {
      updateFeature.mutate({ id, data });
    },
    [updateFeature]
  );

  /** Delete a feature */
  const handleDeleteFeature = useCallback(
    (id: string) => {
      deleteFeature.mutate(id);
    },
    [deleteFeature]
  );

  const containerStyle = useMemo<ViewStyle>(
    () => ({
      flex: 1,
      backgroundColor: colors.base,
    }),
    [colors]
  );

  const headerStyle = useMemo<ViewStyle>(
    () => ({
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      gap: spacing.sm,
    }),
    [spacing]
  );

  const wsPickerStyle = useMemo<ViewStyle>(
    () => ({
      flexDirection: 'row',
      gap: spacing.xs,
      flexWrap: 'wrap',
    }),
    [spacing]
  );

  const isLoading = wsLoading || docsLoading || featuresLoading;

  return (
    <SafeAreaView edges={['bottom']} style={containerStyle}>
      {/* Header with workspace picker and tab toggle */}
      <View style={headerStyle}>
        <Text
          style={{
            color: colors.textPrimary,
            fontFamily: fonts.sans.bold,
            fontSize: typography.sizes.xl,
          }}
        >
          Docs
        </Text>

        {/* Workspace picker chips */}
        {workspaces.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={wsPickerStyle}
          >
            {workspaces.map((ws) => (
              <Chip
                key={ws.id}
                label={ws.name}
                selected={ws.id === workspaceId}
                onPress={() => setSelectedWsId(ws.id)}
                color={ws.color || undefined}
              />
            ))}
          </ScrollView>
        ) : null}

        {/* Docs / Board toggle */}
        <SegmentedControl
          segments={TABS}
          selectedIndex={activeTab}
          onSelect={setActiveTab}
        />
      </View>

      {/* Loading skeletons */}
      {isLoading ? (
        <View style={{ padding: spacing.md, gap: spacing.md }}>
          <Skeleton width="100%" height={48} borderRadius={8} />
          <Skeleton width="100%" height={120} borderRadius={8} />
          <Skeleton width="100%" height={80} borderRadius={8} />
          <Skeleton width="100%" height={80} borderRadius={8} />
        </View>
      ) : !workspaceId ? (
        <EmptyState
          title="No workspaces"
          description="Connect to a server and create a workspace to get started."
        />
      ) : activeTab === 0 ? (
        /* Docs tab with collapsible sections */
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.accent}
            />
          }
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
        >
          {DOC_SECTIONS.map(({ key, label }) => (
            <DocSection
              key={key}
              title={label}
              section={key}
              items={
                (docs?.[key] as Record<string, unknown>[] | undefined) ?? []
              }
              workspaceId={workspaceId}
              onAdd={handleAddItem}
              onUpdate={handleUpdateItem}
              onDelete={handleDeleteItem}
            />
          ))}
        </ScrollView>
      ) : (
        /* Board tab with feature kanban */
        <FeatureBoard
          features={features}
          onCreate={handleCreateFeature}
          onUpdate={handleUpdateFeature}
          onDelete={handleDeleteFeature}
        />
      )}
    </SafeAreaView>
  );
}
