/**
 * tasks/[id].tsx - Task detail route screen.
 *
 * Reads the task ID from route params, finds the matching task
 * from the useTasks query, and renders the TaskDetail component.
 * Sets the stack header title to the truncated task description.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import { Skeleton } from '@/components/ui';
import { useTasks } from '@/hooks/useTasks';
import { TaskDetail } from '@/components/tasks/TaskDetail';

/**
 * TaskDetailScreen - Route wrapper for the task detail view.
 *
 * Extracts the task ID from URL params, looks up the task from
 * the cached tasks query, and renders TaskDetail or a loading skeleton.
 */
export default function TaskDetailScreen() {
  const { theme } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading } = useTasks();

  const task = data?.tasks?.find((t) => t.id === id);

  /** Truncate title to 40 chars for the header */
  const headerTitle = task
    ? task.description.length > 40
      ? task.description.slice(0, 37) + '...'
      : task.description
    : 'Task Detail';

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: headerTitle,
          headerStyle: { backgroundColor: theme.colors.base },
          headerTintColor: theme.colors.textPrimary,
          headerTitleStyle: {
            fontFamily: fonts.sans.semibold,
            fontSize: 16,
          },
        }}
      />

      {isLoading && (
        <View style={[styles.loading, { backgroundColor: theme.colors.base }]}>
          <Skeleton width="80%" height={24} />
          <Skeleton width="60%" height={16} />
          <Skeleton width="100%" height={200} />
        </View>
      )}

      {!isLoading && !task && (
        <View style={[styles.notFound, { backgroundColor: theme.colors.base }]}>
          <Text
            style={[
              styles.notFoundText,
              { color: theme.colors.textSecondary, fontFamily: fonts.sans.regular },
            ]}
          >
            Task not found
          </Text>
        </View>
      )}

      {!isLoading && task && <TaskDetail task={task} />}
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFoundText: {
    fontSize: 16,
  },
});
