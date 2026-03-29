/**
 * tasks/index.tsx - Tasks kanban screen with board/list toggle.
 *
 * Renders a SegmentedControl to switch between Board and List views.
 * Both views share the same useTasks() data. Shows Skeleton columns
 * while loading and EmptyState when no tasks exist.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/useTheme';
import {
  EmptyState,
  SegmentedControl,
  Skeleton,
} from '@/components/ui';
import { useTasks } from '@/hooks/useTasks';
import { TaskBoard } from '@/components/tasks/TaskBoard';
import { TaskList } from '@/components/tasks/TaskList';
import { CreateTaskSheet } from '@/components/tasks/CreateTaskSheet';

/** Segment options for the view toggle */
const SEGMENTS = ['Board', 'List'];

/**
 * TasksScreen - Main tasks tab with kanban board and list views.
 *
 * SegmentedControl toggles between Board (horizontal kanban) and
 * List (vertical grouped) views. Both use the same task data from
 * the useTasks hook.
 */
export default function TasksScreen() {
  const { theme } = useTheme();
  const { data, isLoading } = useTasks();
  const [viewIndex, setViewIndex] = useState(0);
  const [createVisible, setCreateVisible] = useState(false);

  const tasks = data?.tasks ?? [];

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.container, { backgroundColor: theme.colors.base }]}
    >
      {/* View toggle */}
      <View style={styles.controlBar}>
        <SegmentedControl
          segments={SEGMENTS}
          selectedIndex={viewIndex}
          onSelect={setViewIndex}
        />
      </View>

      {/* Loading state */}
      {isLoading && (
        <View style={styles.skeletonContainer}>
          <Skeleton width="100%" height={120} />
          <Skeleton width="100%" height={120} />
          <Skeleton width="100%" height={80} />
        </View>
      )}

      {/* Empty state */}
      {!isLoading && tasks.length === 0 && (
        <EmptyState
          title="No tasks yet"
          description="Create a worktree task to start managing branches from mobile."
          action={{
            label: 'Create Task',
            onPress: () => setCreateVisible(true),
          }}
        />
      )}

      {/* Board view */}
      {!isLoading && tasks.length > 0 && viewIndex === 0 && (
        <TaskBoard tasks={tasks} />
      )}

      {/* List view */}
      {!isLoading && tasks.length > 0 && viewIndex === 1 && (
        <TaskList tasks={tasks} />
      )}

      <CreateTaskSheet
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  controlBar: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  skeletonContainer: {
    padding: 16,
    gap: 12,
  },
});
