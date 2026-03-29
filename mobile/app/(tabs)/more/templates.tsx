/**
 * more/templates.tsx - Template list screen for managing session templates.
 *
 * Displays all saved session templates in a FlashList with pull-to-refresh.
 * Each template shows its name, command, model, and working directory.
 * Long-press opens a delete action sheet. Empty state guides users
 * to save a session as a template from the session detail screen.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { useAPIClient } from '@/hooks/useAPIClient';
import { fonts } from '@/theme/fonts';
import {
  Card,
  EmptyState,
  Skeleton,
  ActionSheet,
  Toast,
  type ActionSheetAction,
} from '@/components/ui';
import type { SessionTemplate } from '@/types/api';

/**
 * TemplatesScreen - List and manage saved session templates.
 *
 * Features:
 *   - FlashList of template cards with name, command, model, working dir
 *   - Long-press for delete action sheet
 *   - Pull-to-refresh
 *   - Empty state when no templates exist
 */
export default function TemplatesScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const client = useAPIClient();
  const queryClient = useQueryClient();
  const { colors, spacing, radius } = theme;

  // Template data
  const templatesQuery = useQuery({
    queryKey: ['templates'],
    queryFn: () => client!.getTemplates(),
    enabled: !!client,
    staleTime: 30000,
  });
  const templates = templatesQuery.data?.templates ?? [];

  // Action sheet state
  const [actionVisible, setActionVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVariant, setToastVariant] = useState<'success' | 'error'>('success');

  /**
   * Handle long-press on a template to show delete action.
   * @param id - Template ID
   */
  const handleLongPress = useCallback((id: string) => {
    setSelectedId(id);
    setActionVisible(true);
  }, []);

  /**
   * Delete the selected template.
   */
  const handleDelete = useCallback(async () => {
    if (!client || !selectedId) return;
    setActionVisible(false);
    try {
      await client.deleteTemplate(selectedId);
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setToastMessage('Template deleted');
      setToastVariant('success');
      setToastVisible(true);
    } catch {
      setToastMessage('Failed to delete template');
      setToastVariant('error');
      setToastVisible(true);
    }
  }, [client, selectedId, queryClient]);

  const actions = useMemo<ActionSheetAction[]>(
    () => [{ label: 'Delete Template', destructive: true, onPress: handleDelete }],
    [handleDelete]
  );

  /**
   * Render a single template card.
   * @param item - Template data
   */
  const renderItem = useCallback(
    ({ item }: { item: SessionTemplate }) => (
      <Pressable
        onLongPress={() => handleLongPress(item.id)}
        style={[
          styles.templateCard,
          { backgroundColor: colors.surface0, borderRadius: radius.lg, padding: spacing.md, marginHorizontal: spacing.md, marginBottom: spacing.sm },
        ]}
      >
        <Text
          style={[styles.templateName, { color: colors.textPrimary, fontFamily: fonts.sans.semibold }]}
          numberOfLines={1}
        >
          {item.name}
        </Text>
        <Text
          style={[styles.templateField, { color: colors.textMuted, fontFamily: fonts.mono.regular }]}
          numberOfLines={1}
        >
          {item.command || 'claude'}
        </Text>
        {item.model ? (
          <Text
            style={[styles.templateField, { color: colors.textSecondary, fontFamily: fonts.sans.regular }]}
          >
            Model: {item.model}
          </Text>
        ) : null}
        {item.workingDir ? (
          <Text
            style={[styles.templateField, { color: colors.textMuted, fontFamily: fonts.mono.regular }]}
            numberOfLines={1}
          >
            {item.workingDir}
          </Text>
        ) : null}
      </Pressable>
    ),
    [colors, radius, spacing, handleLongPress]
  );

  const keyExtractor = useCallback((item: SessionTemplate) => item.id, []);

  // Loading state
  if (templatesQuery.isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.base }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>
          <Text style={[styles.title, { color: colors.textPrimary, fontFamily: fonts.sans.semibold }]}>
            Templates
          </Text>
        </View>
        <View style={{ padding: spacing.md, gap: spacing.sm }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={80} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.base }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.textPrimary, fontFamily: fonts.sans.semibold }]}>
          Templates
        </Text>
      </View>

      {templates.length === 0 ? (
        <EmptyState
          title="No Templates"
          description="Save a session as a template from the session detail screen to reuse configurations."
        />
      ) : (
        <FlashList
          data={templates}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          refreshing={templatesQuery.isRefetching}
          onRefresh={() => templatesQuery.refetch()}
          contentContainerStyle={styles.listContent}
        />
      )}

      <ActionSheet
        visible={actionVisible}
        onClose={() => setActionVisible(false)}
        actions={actions}
      />

      <Toast
        visible={toastVisible}
        message={toastMessage}
        variant={toastVariant}
        onDismiss={() => setToastVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 4,
  },
  backButton: {
    padding: 8,
  },
  title: {
    fontSize: 22,
  },
  listContent: {
    paddingBottom: 16,
    paddingTop: 8,
  },
  templateCard: {
    gap: 4,
  },
  templateName: {
    fontSize: 15,
  },
  templateField: {
    fontSize: 12,
  },
});
