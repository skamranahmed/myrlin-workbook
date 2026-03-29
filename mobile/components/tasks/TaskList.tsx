/**
 * TaskList.tsx - Alternative list view for worktree tasks.
 *
 * Groups tasks into 5 sections by status (same order as board columns).
 * Each section has a SectionHeader with status name and count, followed
 * by TaskCard items. Uses FlatList with section-style rendering.
 */

import React, { useMemo } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { SectionHeader } from '@/components/ui';
import type { WorktreeTask, TaskStatus } from '@/types/api';
import { TaskCard } from './TaskCard';

/** Ordered sections matching the kanban columns */
const SECTION_ORDER: { status: TaskStatus; label: string }[] = [
  { status: 'backlog', label: 'Backlog' },
  { status: 'planning', label: 'Planning' },
  { status: 'running', label: 'Running' },
  { status: 'review', label: 'Review' },
  { status: 'done', label: 'Done' },
];

/** Union type for list items (header or card) */
type ListItem =
  | { type: 'header'; label: string; count: number; key: string }
  | { type: 'card'; task: WorktreeTask; key: string };

interface TaskListProps {
  /** All tasks to group and display */
  tasks: WorktreeTask[];
}

/**
 * TaskList - Sectioned list view of worktree tasks grouped by status.
 *
 * Renders section headers with task counts followed by TaskCard items.
 * Sections with zero tasks still show the header for visual consistency.
 *
 * @param props.tasks - Full list of worktree tasks
 */
export function TaskList({ tasks }: TaskListProps) {
  /** Build a flat list with interleaved section headers and cards */
  const listData = useMemo<ListItem[]>(() => {
    const items: ListItem[] = [];
    for (const section of SECTION_ORDER) {
      const sectionTasks = tasks.filter((t) => t.status === section.status);
      items.push({
        type: 'header',
        label: section.label,
        count: sectionTasks.length,
        key: `header-${section.status}`,
      });
      for (const task of sectionTasks) {
        items.push({ type: 'card', task, key: task.id });
      }
    }
    return items;
  }, [tasks]);

  /** Render either a section header or a task card */
  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'header') {
      return <SectionHeader title={`${item.label} (${item.count})`} />;
    }
    return <TaskCard task={item.task} />;
  };

  return (
    <FlatList
      data={listData}
      renderItem={renderItem}
      keyExtractor={(item) => item.key}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingBottom: 80,
  },
});
